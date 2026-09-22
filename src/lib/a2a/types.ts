/**
 * A2A (Agent-to-Agent) Protocol Types & Schema Specifications
 * Compliant with emerging open A2A inter-agent standards
 */

export type A2APerformative =
  | "REQUEST"   // Ask an agent to perform a task or achieve a goal
  | "INFORM"    // Share facts, deliverables, or status updates
  | "PROPOSE"   // Offer a proposed plan or delegation breakdown
  | "ACCEPT"    // Confirm proposal or delegation terms
  | "REJECT"    // Decline task delegation with reason
  | "QUERY"     // Ask a clarification or state query
  | "CANCEL";   // Abort an active delegated task

export interface A2AParticipant {
  id: string;
  name: string;
  role?: string;
  endpoint?: string;
}

export interface A2AArtifact {
  id: string;
  name: string;
  mimeType: string;
  uri?: string;
  content?: string;
  sizeBytes?: number;
}

export interface A2AMessage<T = any> {
  protocol: "a2a/1.0";
  messageId: string;
  conversationId: string;
  parentMessageId?: string;
  timestamp: string;
  sender: A2AParticipant;
  recipient: A2AParticipant;
  performative: A2APerformative;
  payload: T;
  artifacts?: A2AArtifact[];
  metadata?: {
    traceId?: string;
    delegationDepth?: number;
    timeoutMs?: number;
    priority?: "low" | "normal" | "high";
    custom?: Record<string, any>;
  };
}

export interface A2ATaskPayload {
  goal: string;
  context?: Record<string, any>;
  input?: string;
  parameters?: Record<string, any>;
  deliverableFormat?: string;
}

export interface A2AWorkerResponse {
  status: "completed" | "failed" | "awaiting_approval" | "rejected";
  deliverable?: string;
  output?: any;
  error?: string;
  artifacts?: A2AArtifact[];
  metadata?: {
    durationMs?: number;
    agentName?: string;
    model?: string;
    tokensUsed?: number;
  };
}

export interface A2AAgentCard {
  protocol: "a2a/1.0";
  agentId: string;
  name: string;
  archetype: string;
  description: string;
  endpoint: string;
  capabilities: {
    supportedPerformatives: A2APerformative[];
    streaming?: boolean;
    humanInTheLoop?: boolean;
    maxConcurrentTasks?: number;
  };
  inputSchema?: Record<string, any>;
  outputSchema?: Record<string, any>;
  version?: string;
}
