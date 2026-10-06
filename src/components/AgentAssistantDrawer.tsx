"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { BridgeEnvelope, RequestApprovalPayload } from "@/lib/agent-bridge";
import { AlertIcon, CheckIcon, CrossIcon, SparkIcon } from "./agent-ui";

export interface AgentOption {
  id: string;
  name: string;
  archetype?: string;
  description?: string;
}

/** One line of the conversation. Agent lines follow a real run until it ends. */
export type AssistantMessage = {
  id: string;
  from: "you" | "app" | "agent";
  text: string;
  at: string;
  agentName?: string;
  runId?: string;
  status?: "running" | "done" | "failed" | "waiting";
};

interface AgentAssistantDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  availableAgents: AgentOption[];
  activeAgentId: string | null;
  onSelectAgent: (agentId: string) => void;
  messages: AssistantMessage[];
  bridgeEvents: BridgeEnvelope[];
  pendingApprovals: RequestApprovalPayload[];
  onResolveApproval: (approvalId: string, decision: "approved" | "rejected") => void;
  activeContext: Record<string, any> | null;
  appName: string;
  onSendMessage: (text: string) => void;
  isExecuting?: boolean;
}

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export default function AgentAssistantDrawer({
  isOpen, onClose, availableAgents, activeAgentId, onSelectAgent, messages, bridgeEvents, pendingApprovals,
  onResolveApproval, activeContext, appName, onSendMessage, isExecuting = false,
}: AgentAssistantDrawerProps) {
  const [text, setText] = useState("");
  const [tab, setTab] = useState<"chat" | "shared" | "log">("chat");
  const end = useRef<HTMLDivElement>(null);
  const selected = availableAgents.find((a) => a.id === activeAgentId) || availableAgents[0];

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages.length, messages[messages.length - 1]?.status]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || !selected) return;
    onSendMessage(text.trim());
    setText("");
  }

  return (
    <aside className={`cv-assist ${isOpen ? "open" : ""}`} aria-hidden={!isOpen} aria-label="Ask an agent">
      <div className="cv-assist-head">
        <span className="cv-assist-ic"><SparkIcon size={15} /></span>
        <div className="grow">
          <b>Ask an agent</b>
          <span>about {appName}</span>
        </div>
        <button className="cv-icon-btn" onClick={onClose} aria-label="Close"><CrossIcon size={12} /></button>
      </div>

      <div className="cv-assist-agent">
        <label htmlFor="cv-agent">Agent</label>
        <select id="cv-agent" className="select-sm" value={selected?.id ?? ""} onChange={(e) => onSelectAgent(e.target.value)} disabled={!availableAgents.length}>
          {!availableAgents.length && <option value="">No agents in this workspace yet</option>}
          {availableAgents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>

      {pendingApprovals.length > 0 && (
        <div className="cv-approvals">
          <div className="cv-approvals-head"><AlertIcon size={13} /> {appName} is asking for {pendingApprovals.length === 1 ? "an approval" : `${pendingApprovals.length} approvals`}</div>
          {pendingApprovals.map((r) => (
            <div key={r.approvalId} className="cv-approval">
              <code>{r.action}</code>
              <p>{r.summary}</p>
              {r.payload && Object.keys(r.payload).length > 0 && (
                <dl>
                  {Object.entries(r.payload).map(([k, v]) => (
                    <div key={k}><dt>{k}</dt><dd>{typeof v === "object" ? JSON.stringify(v) : String(v)}</dd></div>
                  ))}
                </dl>
              )}
              <div className="cv-approval-go">
                <button className="btn btn-sm btn-danger" onClick={() => onResolveApproval(r.approvalId, "rejected")}><CrossIcon size={11} /> Reject</button>
                <button className="btn btn-sm btn-primary" onClick={() => onResolveApproval(r.approvalId, "approved")}><CheckIcon size={12} /> Approve</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="cv-tabs" role="tablist">
        <button role="tab" aria-selected={tab === "chat"} className={tab === "chat" ? "on" : ""} onClick={() => setTab("chat")}>Chat</button>
        <button role="tab" aria-selected={tab === "shared"} className={tab === "shared" ? "on" : ""} onClick={() => setTab("shared")}>
          Shared by the app {activeContext && <i className="cv-dot" />}
        </button>
        <button role="tab" aria-selected={tab === "log"} className={tab === "log" ? "on" : ""} onClick={() => setTab("log")}>Log <span>{bridgeEvents.length}</span></button>
      </div>

      {tab === "chat" && (
        <>
          <div className="cv-chat">
            <div className="cv-chat-intro">
              Your message goes to <b>{selected?.name ?? "an agent"}</b> as a new run, with anything {appName} has shared (see <em>Shared by the app</em>). The agent does not see the screen itself.
            </div>
            {!availableAgents.length && (
              <div className="cv-chat-intro">Build an agent first under <Link href="/agents">Agents</Link>, then ask it about this app here.</div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={`cv-msg ${m.from} ${m.status ?? ""}`}>
                <span className="cv-msg-who">
                  {m.from === "you" ? "You" : m.from === "app" ? appName : m.agentName ?? "Agent"}
                  <em>{time(m.at)}</em>
                </span>
                <div className="cv-msg-text">
                  {m.status === "running" && <span className="cv-spin" />}
                  {m.text}
                </div>
                {m.runId && <Link className="cv-msg-run" href={`/runs/${m.runId}`}>Open the run →</Link>}
              </div>
            ))}
            <div ref={end} />
          </div>
          <form className="cv-chat-input" onSubmit={submit}>
            <textarea
              rows={2}
              value={text}
              placeholder={selected ? `Ask ${selected.name}…` : "No agent to ask yet"}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit(e as any);
                }
              }}
              disabled={!selected}
            />
            <button className="btn btn-primary btn-sm" type="submit" disabled={!text.trim() || !selected}>Send</button>
          </form>
        </>
      )}

      {tab === "shared" && (
        <div className="cv-pane">
          {activeContext ? (
            <>
              <p className="cv-pane-note">The latest state {appName} sent with <code>sendContext</code>. It goes with every message you send.</p>
              <pre className="cv-pre">{JSON.stringify(activeContext, null, 2)}</pre>
            </>
          ) : (
            <p className="cv-pane-note">
              {appName} hasn&apos;t shared anything. An app shares what is on screen — the selected record, filters, the current view — by calling <code>AgentStudioBridge.sendContext(…)</code>. See the developer panel (the <b>&lt;/&gt;</b> button) for how.
            </p>
          )}
        </div>
      )}

      {tab === "log" && (
        <div className="cv-pane">
          {!bridgeEvents.length ? (
            <p className="cv-pane-note">No messages between {appName} and Agent Studio yet.</p>
          ) : (
            <ul className="cv-log">
              {bridgeEvents.map((ev, i) => (
                <li key={i}>
                  <span className="cv-log-top"><code className={`cv-tag ${ev.action}`}>{ev.action}</code><em>{new Date(ev.timestamp).toLocaleTimeString()}</em></span>
                  <pre>{JSON.stringify(ev.payload, null, 2)}</pre>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </aside>
  );
}
