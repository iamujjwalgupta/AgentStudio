"use client";

import { AlertIcon } from "@/components/agent-ui";

/**
 * What a held action would do, shown as the thing itself — an email as an
 * email, SQL as a statement — rather than as raw JSON. Used on the Approvals
 * page and on a run's page. Styles live in approvals.css (apv-*).
 */

const str = (v: any) => (v == null ? "" : typeof v === "string" ? v : JSON.stringify(v, null, 2));

function Fields({ rows }: { rows: [string, any][] }) {
  const shown = rows.filter(([, v]) => v !== undefined && v !== null && v !== "");
  if (!shown.length) return null;
  return (
    <dl className="apv-fields">
      {shown.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{typeof v === "object" ? <code>{JSON.stringify(v)}</code> : String(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function ActionPreview({ tool, p }: { tool: string; p: any }) {
  const x = p && typeof p === "object" ? p : { value: p };
  switch (tool) {
    case "send_email":
      return (
        <div className="apv-mail">
          <Fields rows={[["To", Array.isArray(x.to) ? x.to.join(", ") : x.to], ["Subject", x.subject]]} />
          <div className="apv-body">{str(x.body)}</div>
        </div>
      );
    case "post_message":
    case "post_teams_message":
      return (
        <div className="apv-chat">
          <span className="apv-chat-where">{tool === "post_message" ? "Slack · the connected channel" : "Microsoft Teams · the connected channel"}</span>
          <div className="apv-bubble">
            {x.title && <b>{x.title}</b>}
            {str(x.text)}
          </div>
        </div>
      );
    case "sql_execute":
    case "sql_query":
      return (
        <div>
          {tool === "sql_execute" && (
            <div className="apv-warn"><AlertIcon size={13} /> This statement changes data in the database{x.connection ? ` (${x.connection})` : ""}.</div>
          )}
          <pre className="apv-code">{str(x.sql)}</pre>
          <Fields rows={[["Connection", tool === "sql_query" ? x.connection : undefined], ["Row limit", x.limit]]} />
        </div>
      );
    case "http_request":
      return (
        <div>
          <div className="apv-http">
            <span className={`apv-method ${String(x.method || "GET").toLowerCase()}`}>{String(x.method || "GET").toUpperCase()}</span>
            <code>{x.path || "/"}</code>
          </div>
          <Fields rows={[["Connection", x.connection], ["Query", x.query]]} />
          {x.body != null && x.body !== "" && <pre className="apv-code">{str(x.body)}</pre>}
        </div>
      );
    case "write_file":
      return (
        <div>
          <Fields rows={[["File", x.filename]]} />
          <pre className="apv-code">{str(x.content).split("\n").slice(0, 60).join("\n")}{str(x.content).split("\n").length > 60 ? "\n…" : ""}</pre>
        </div>
      );
    case "jira_create_issue":
    case "github_create_issue":
      return (
        <div className="apv-issue">
          <div className="apv-issue-where">
            {tool === "jira_create_issue" ? <>Jira · {x.project || "project"}{x.issueType ? ` · ${x.issueType}` : ""}</> : <>GitHub · {x.repo || "repository"}</>}
          </div>
          <b>{x.summary || x.title}</b>
          {(x.description || x.body) && <div className="apv-body">{str(x.description || x.body)}</div>}
          {Array.isArray(x.labels) && x.labels.length > 0 && (
            <div className="apv-labels">{x.labels.map((l: string) => <span key={l}>{l}</span>)}</div>
          )}
        </div>
      );
    case "kv_set":
      return <Fields rows={[["Key", x.key], ["New value", x.value], ["Expires after", x.ttlSeconds ? `${x.ttlSeconds} s` : undefined], ["Connection", x.connection]]} />;
    case "invoke_agent":
      return (
        <div>
          <Fields rows={[["Hand to agent", x.agent]]} />
          <div className="apv-body">{str(x.input)}</div>
        </div>
      );
    default:
      return <Fields rows={Object.entries(x)} />;
  }
}

