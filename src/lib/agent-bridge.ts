/**
 * Agent Studio Bi-directional Bridge Protocol
 * Enables embedded canvas apps to communicate securely with Agent Studio
 */

export const BRIDGE_MESSAGE_TYPE = "AGENT_STUDIO_BRIDGE";

export type BridgeAction =
  | "TRIGGER_AGENT"
  | "AGENT_EVENT"
  | "REQUEST_APPROVAL"
  | "APPROVAL_RESPONSE"
  | "SEND_CONTEXT"
  | "APPLY_PRESET"
  | "PING"
  | "PONG";

export interface BridgeEnvelope<T = any> {
  source: "AGENT_STUDIO_BRIDGE";
  action: BridgeAction;
  requestId?: string;
  payload: T;
  timestamp: string;
}

export interface TriggerAgentPayload {
  agentNameOrId: string;
  input: string;
  context?: Record<string, any>;
}

export interface AgentEventPayload {
  runId?: string;
  status: "pending" | "running" | "chunk" | "completed" | "failed";
  text?: string;
  error?: string;
  toolCall?: {
    toolName: string;
    args: Record<string, any>;
  };
}

export interface RequestApprovalPayload {
  approvalId: string;
  action: string;
  summary: string;
  payload: Record<string, any>;
}

export interface ApprovalResponsePayload {
  approvalId: string;
  decision: "approved" | "rejected";
  reason?: string;
}

export interface SendContextPayload {
  appId?: string;
  currentUrl?: string;
  selectedEntity?: any;
  appState?: Record<string, any>;
}

export interface ApplyPresetPayload {
  presetName: string;
  parameters: Record<string, any>;
  urlPath?: string;
}

export interface CanvasBookmark {
  id: string;
  appId: string;
  title: string;
  url: string;
  note?: string;
  createdAt: string;
}

export interface CanvasPreset {
  id: string;
  appId?: string;
  name: string;
  description: string;
  parameters: Record<string, any>;
  urlSuffix?: string;
}

/**
 * Validate that an incoming postMessage event is a genuine Agent Studio Bridge message
 */
export function isValidBridgeMessage(data: any): data is BridgeEnvelope {
  return (
    typeof data === "object" &&
    data !== null &&
    data.source === BRIDGE_MESSAGE_TYPE &&
    typeof data.action === "string"
  );
}

/**
 * Helper to construct a validated bridge envelope
 */
export function createBridgeMessage<T>(action: BridgeAction, payload: T, requestId?: string): BridgeEnvelope<T> {
  return {
    source: BRIDGE_MESSAGE_TYPE,
    action,
    requestId: requestId || Math.random().toString(36).substring(2, 9),
    payload,
    timestamp: new Date().toISOString(),
  };
}
