import { NextRequest, NextResponse } from "next/server";
import { one } from "@/lib/db";
import { startRun } from "@/lib/orchestrator";
import { budgetCheck } from "@/lib/spend";
import { maskPII, checkRateLimit } from "@/lib/guardrails";
import { keyCoversAgent, resolveCaller } from "@/lib/api-keys";
import { originOf, runResult, unfinished, waitForRun } from "@/lib/api-runs";
import type { AgentSpec } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Who may call this: another application holding one of the workspace's API
 * keys (Workspace → API keys), or a signed-in member of the agent's workspace.
 * A key runs the published version only, and only the agents it was made for;
 * a signed-in person runs the draft until there is a published version.
 * Calls are server to server: browsers on other sites are not invited (no
 * cross-origin headers), so a key never needs to sit in a web page.
 */

/** The longest ?wait=true holds the request open, inside the route's 300s limit. */
const MAX_WAIT_S = 240;

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}

/** The agent, only when it belongs to the caller's workspace; another workspace's agent reads as not found. */
async function agentFor(agentId: string, orgId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(agentId)) return null;
  return one<any>(`select * from agents where id = $1 and org_id = $2`, [agentId, orgId]);
}

/** The caller and the agent, or the response that refuses them. */
async function admit(req: NextRequest, agentId: string) {
  const caller = await resolveCaller(req);
  if ("error" in caller) return { refuse: NextResponse.json({ error: caller.error }, { status: 401 }) };
  const agent = await agentFor(agentId, caller.orgId);
  if (!agent || (caller.kind === "key" && !keyCoversAgent(caller.key, agentId))) {
    const error =
      agent && caller.kind === "key"
        ? `The API key “${caller.key.name}” is not allowed to run this agent. An admin can widen it under Workspace → API keys.`
        : "Agent not found";
    return { refuse: NextResponse.json({ error }, { status: agent ? 403 : 404 }) };
  }
  return { caller, agent };
}

/**
 * GET /api/v1/agents/{id}/invoke
 * Returns OpenAPI 3.0 specification for this agent
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: agentId } = await params;
  const got = await admit(req, agentId);
  if ("refuse" in got) return got.refuse;
  const { agent } = got;

  const spec: AgentSpec = agent.published_ver
    ? (await one<any>(`select spec from agent_versions where agent_id = $1 and version = $2`, [agentId, agent.published_ver]))?.spec || agent.draft_spec
    : agent.draft_spec;

  const runSchema = {
    type: "object",
    properties: {
      runId: { type: "string" },
      agentId: { type: "string" },
      agentName: { type: "string" },
      status: { type: "string", enum: ["running", "awaiting_approval", "completed", "failed", "rejected"] },
      message: { type: "string", description: "Where the run has got to, in words." },
      output: { type: "string", nullable: true, description: "The agent's answer, once the run has completed." },
      error: { type: "string", nullable: true },
      waitingFor: {
        type: "array",
        description: "Actions held for a person to approve in Agent Studio.",
        items: { type: "object", properties: { action: { type: "string" }, since: { type: "string", format: "date-time" } } },
      },
      usage: {
        type: "object",
        properties: {
          inputTokens: { type: "integer" },
          outputTokens: { type: "integer" },
          costUsd: { type: "number" },
        },
      },
      statusUrl: { type: "string", description: "GET this, with the same key, to see the run again." },
      runUrl: { type: "string", description: "The run in Agent Studio, for a person." },
    },
  };

  const openApiSpec = {
    openapi: "3.0.3",
    info: {
      title: `${agent.name} - Agent Studio API`,
      description: spec.purpose || `Automated autonomous agent: ${agent.name}`,
      version: String(agent.published_ver || 1),
    },
    servers: [{ url: `${originOf(req)}/api/v1` }],
    components: {
      securitySchemes: {
        apiKey: {
          type: "http",
          scheme: "bearer",
          description: "A workspace API key (as_live_…), created by an admin under Workspace → API keys.",
        },
      },
    },
    security: [{ apiKey: [] }],
    paths: {
      [`/agents/${agentId}/invoke`]: {
        post: {
          summary: `Invoke ${agent.name}`,
          description:
            `Start a run of ${agent.name}'s published version. Without wait, it answers at once (202) with a runId and a ` +
            `statusUrl to ask again; with wait=true it holds on until the run finishes, up to ${MAX_WAIT_S} seconds.`,
          parameters: [
            {
              name: "wait",
              in: "query",
              required: false,
              description: `true to wait for the result (up to ${MAX_WAIT_S}s), or a number of seconds to wait.`,
              schema: { type: "string", example: "true" },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    input: {
                      type: "string",
                      description: "Primary user prompt or instruction to direct the agent.",
                      example: "Analyze data and execute assigned procedure.",
                    },
                    inputs: {
                      type: "object",
                      description: "Values for the agent's run form, by field key.",
                      additionalProperties: true,
                    },
                    dryRun: {
                      type: "boolean",
                      description: "If true, rehearses without carrying out approval-gated actions.",
                      default: false,
                    },
                  },
                  required: ["input"],
                },
              },
            },
          },
          responses: {
            "200": { description: "The run has finished (completed, failed or rejected).", content: { "application/json": { schema: runSchema } } },
            "202": { description: "The run is still going, or waiting for an approval. Ask statusUrl again.", content: { "application/json": { schema: runSchema } } },
            "401": { description: "No API key, or not a valid one." },
            "402": { description: "A usage limit has been reached." },
            "403": { description: "The key is not allowed to run this agent." },
            "409": { description: "The agent has no published version, or is retired." },
            "429": { description: "Per-agent rate limit exceeded (RPM or TPM)" },
          },
        },
      },
      "/runs/{runId}": {
        get: {
          summary: "See a run again",
          description: "Where a run started with this key has got to, and its answer once it has one.",
          parameters: [{ name: "runId", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "The run has finished.", content: { "application/json": { schema: runSchema } } },
            "202": { description: "Still going, or waiting for an approval.", content: { "application/json": { schema: runSchema } } },
            "404": { description: "No such run for this key." },
          },
        },
      },
    },
  };

  return NextResponse.json(openApiSpec);
}

/**
 * POST /api/v1/agents/{id}/invoke[?wait=true]
 * Standalone REST invocation endpoint
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: agentId } = await params;

  const got = await admit(req, agentId);
  if ("refuse" in got) return got.refuse;
  const { caller, agent } = got;

  if (agent.status === "retired") {
    return NextResponse.json({ error: "This agent is retired and cannot be invoked." }, { status: 409 });
  }
  // What runs from outside is what was reviewed: a key never runs a draft.
  if (caller.kind === "key" && !agent.published_ver) {
    return NextResponse.json(
      { error: `${agent.name} has no published version yet. API keys run published agents only; publish it in Agent Studio first.` },
      { status: 409 },
    );
  }

  // Resolve spec
  let spec: AgentSpec = agent.draft_spec;
  let version: number | null = null;
  if (agent.published_ver) {
    const v = await one<any>(
      `select spec, version from agent_versions where agent_id = $1 and version = $2`,
      [agentId, agent.published_ver]
    );
    if (v) {
      spec = v.spec;
      version = v.version;
    }
  }

  // 1. Enforce Per-Agent Rate Limiting
  const rateLimitRpm = spec.guardrails?.rateLimitRpm || 60;
  const rateLimitTpm = spec.guardrails?.rateLimitTpm;
  const rateCheck = checkRateLimit(agentId, rateLimitRpm, rateLimitTpm);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      {
        error: "Too Many Requests",
        message: `Rate limit of ${rateLimitRpm} RPM exceeded for ${agent.name}.`,
        retryAfterSeconds: rateCheck.retryAfterSeconds,
      },
      { status: 429, headers: { "Retry-After": String(rateCheck.retryAfterSeconds) } }
    );
  }

  // Parse Body
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const rawInput = body.input || body.prompt || "Execute assigned agent procedure.";
  const inputs = body.parameters || body.inputs || {};
  const dryRun = Boolean(body.dryRun);
  // ?wait=true waits as long as allowed; ?wait=30 waits up to 30 seconds.
  const waitParam = req.nextUrl.searchParams.get("wait") ?? (body.wait === undefined ? null : String(body.wait));
  const waitS = !waitParam || waitParam === "false" || waitParam === "0"
    ? 0
    : waitParam === "true"
      ? MAX_WAIT_S
      : Math.min(MAX_WAIT_S, Math.max(0, Number(waitParam) || 0));

  // 2. Apply DLP & PII Masking
  let effectiveInput = rawInput;
  let dlpDetections: any[] = [];
  if (spec.guardrails?.dlpEnabled) {
    const dlpResult = maskPII(rawInput, {
      enabled: true,
      redactCreditCards: spec.guardrails.redactCreditCards,
      redactEmails: spec.guardrails.redactEmails,
      redactCredentials: spec.guardrails.redactCredentials,
      redactPhoneNumbers: spec.guardrails.redactPhoneNumbers,
      customPatterns: spec.guardrails.customDlpPatterns,
    });
    effectiveInput = dlpResult.text;
    dlpDetections = dlpResult.detections;
  }

  // Runs started from outside meet the same usage limits as any other.
  const budget = await budgetCheck(agent.org_id, agent.id);
  if (!budget.ok) return NextResponse.json({ error: budget.reason }, { status: 402 });

  try {
    // Start the run; it carries on in the background either way.
    const runId = await startRun({
      orgId: agent.org_id,
      agentId,
      spec,
      version,
      input: effectiveInput,
      user: caller.user,
      trigger: "api",
      dryRun,
      inputs,
      apiKeyId: caller.kind === "key" ? caller.key.id : undefined,
    });

    if (waitS) await waitForRun(runId, waitS * 1000);
    const result = await runResult(runId, originOf(req));
    if (!result) throw new Error("The run could not be read back.");

    return NextResponse.json(
      {
        ...result,
        dlp: { applied: Boolean(spec.guardrails?.dlpEnabled), inputDetections: dlpDetections },
      },
      { status: unfinished(result.status) ? 202 : 200 }
    );
  } catch (err: any) {
    console.error(`[API Invoke Error: ${agent.name}]`, err);
    return NextResponse.json(
      {
        error: "Invocation failed",
        detail: err.message || String(err),
      },
      { status: 500 }
    );
  }
}
