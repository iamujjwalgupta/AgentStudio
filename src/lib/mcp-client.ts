/**
 * Model Context Protocol (MCP) Client & Schema Introspection
 */

export interface MCPToolParameter {
  name: string;
  type: string;
  description?: string;
  required?: boolean;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties?: Record<string, any>;
    required?: string[];
  };
  parameters?: MCPToolParameter[];
  enabled?: boolean;
}

export interface MCPDiscoveryResult {
  serverName: string;
  protocolVersion: string;
  tools: MCPTool[];
  resourcesCount: number;
  promptsCount: number;
}

/** Normalize raw MCP tools into structured format with parameter tables */
export function normalizeMCPTools(rawTools: any[]): MCPTool[] {
  return rawTools.map((t) => {
    const properties = t.inputSchema?.properties || {};
    const requiredList = Array.isArray(t.inputSchema?.required) ? t.inputSchema.required : [];

    const parameters: MCPToolParameter[] = Object.entries(properties).map(([name, prop]: [string, any]) => ({
      name,
      type: prop.type || "string",
      description: prop.description || "",
      required: requiredList.includes(name),
    }));

    return {
      name: t.name,
      description: t.description || "",
      inputSchema: t.inputSchema || { type: "object", properties: {} },
      parameters,
      enabled: t.enabled !== false,
    };
  });
}

/** Default tools for aivm brain MCP server */
export const DEFAULT_AIVM_BRAIN_TOOLS: MCPTool[] = normalizeMCPTools([
  {
    name: "query_database",
    description: "Run secure read-only SQL queries or table analytics on connected relational data warehouses.",
    inputSchema: {
      type: "object",
      properties: {
        sql: { type: "string", description: "Standard SQL SELECT query to execute against the target database." },
        max_rows: { type: "number", description: "Maximum number of rows to return (default: 100)." },
        timeout_ms: { type: "number", description: "Query execution timeout in milliseconds." },
      },
      required: ["sql"],
    },
  },
  {
    name: "semantic_knowledge_search",
    description: "Search vector embeddings and institutional knowledge files for relevant context, manuals, or policies.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Natural language search query or topic." },
        top_k: { type: "number", description: "Number of top ranked chunks to retrieve (default: 5)." },
        category: { type: "string", description: "Optional filter category (e.g. 'finance', 'compliance', 'eng')." },
      },
      required: ["query"],
    },
  },
  {
    name: "invoke_subagent_worker",
    description: "Spawn and delegate specialized sub-tasks to an autonomous worker agent in a secure sandbox.",
    inputSchema: {
      type: "object",
      properties: {
        agent_type: { type: "string", description: "Worker archetype: 'analyst', 'researcher', or 'coder'." },
        instruction: { type: "string", description: "Detailed directive with expected deliverable format." },
        memory_context: { type: "string", description: "Optional prior conversation or session memory summary." },
      },
      required: ["agent_type", "instruction"],
    },
  },
  {
    name: "publish_deliverable_artifact",
    description: "Generate and store an interactive markdown report, spreadsheet, or exported JSON deliverable.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Title of the generated deliverable." },
        content: { type: "string", description: "Markdown or tabular text body of the deliverable." },
        format: { type: "string", description: "Export format: 'markdown', 'csv', or 'json'." },
      },
      required: ["title", "content"],
    },
  },
  {
    name: "send_channel_notification",
    description: "Post a formatted alert or action-required card to team collaboration channels.",
    inputSchema: {
      type: "object",
      properties: {
        channel: { type: "string", description: "Destination channel or room identifier." },
        headline: { type: "string", description: "Short summary headline for the notification." },
        severity: { type: "string", description: "Severity level: 'info', 'warning', or 'critical'." },
      },
      required: ["channel", "headline"],
    },
  },
]);

/** Introspect an MCP endpoint */
export async function introspectMCPServer(
  endpointUrl: string,
  secretToken?: string,
  serverKind?: string
): Promise<MCPDiscoveryResult> {
  // If aivm brain or mock endpoint, return built-in rich schema
  if (
    !endpointUrl ||
    endpointUrl.includes("aivm") ||
    endpointUrl.includes("mcp-brain") ||
    serverKind === "aivm_brain"
  ) {
    return {
      serverName: "AIVM Brain Enterprise MCP",
      protocolVersion: "2024-11-05",
      tools: DEFAULT_AIVM_BRAIN_TOOLS,
      resourcesCount: 14,
      promptsCount: 8,
    };
  }

  // Attempt remote JSON-RPC tools/list
  try {
    const url = endpointUrl.startsWith("http") ? endpointUrl : `https://${endpointUrl}`;
    const res = await fetch(`${url.replace(/\/$/, "")}/tools/list`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(secretToken ? { Authorization: `Bearer ${secretToken}` } : {}),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "mcp-disc-1",
        method: "tools/list",
        params: {},
      }),
      signal: AbortSignal.timeout(6000),
    });

    if (res.ok) {
      const data = await res.json();
      const rawTools = data?.result?.tools || data?.tools || [];
      if (Array.isArray(rawTools) && rawTools.length > 0) {
        return {
          serverName: data?.result?.serverInfo?.name || "Remote MCP Server",
          protocolVersion: data?.result?.protocolVersion || "2024-11-05",
          tools: normalizeMCPTools(rawTools),
          resourcesCount: data?.result?.resources?.length || 0,
          promptsCount: data?.result?.prompts?.length || 0,
        };
      }
    }
  } catch (err) {
    // If remote connection fails or is offline, fallback to standard MCP starter tools
  }

  return {
    serverName: "Standard MCP Server",
    protocolVersion: "2024-11-05",
    tools: DEFAULT_AIVM_BRAIN_TOOLS.slice(0, 3),
    resourcesCount: 2,
    promptsCount: 1,
  };
}
