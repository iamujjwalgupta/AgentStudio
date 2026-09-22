import crypto from "crypto";
import type { A2AMessage, A2AParticipant, A2APerformative, A2ATaskPayload } from "./types";

/**
 * Constructs a standardized A2A message envelope
 */
export function createA2AMessage<T = any>(params: {
  sender: A2AParticipant;
  recipient: A2AParticipant;
  performative: A2APerformative;
  payload: T;
  conversationId?: string;
  parentMessageId?: string;
  metadata?: Record<string, any>;
}): A2AMessage<T> {
  return {
    protocol: "a2a/1.0",
    messageId: `msg_${crypto.randomUUID()}`,
    conversationId: params.conversationId || `conv_${crypto.randomUUID()}`,
    parentMessageId: params.parentMessageId,
    timestamp: new Date().toISOString(),
    sender: params.sender,
    recipient: params.recipient,
    performative: params.performative,
    payload: params.payload,
    metadata: {
      traceId: crypto.randomUUID(),
      ...params.metadata,
    },
  };
}

/**
 * Constructs an A2A Task Delegation Envelope
 */
export function createA2ATaskEnvelope(params: {
  supervisor: { id: string; name: string };
  worker: { id: string; name: string; endpoint?: string };
  goal: string;
  context?: Record<string, any>;
  input?: string;
  conversationId?: string;
  timeoutMs?: number;
}): A2AMessage<A2ATaskPayload> {
  return createA2AMessage<A2ATaskPayload>({
    sender: {
      id: params.supervisor.id,
      name: params.supervisor.name,
      role: "Supervisor Coordinator",
    },
    recipient: {
      id: params.worker.id,
      name: params.worker.name,
      endpoint: params.worker.endpoint,
    },
    performative: "REQUEST",
    payload: {
      goal: params.goal,
      input: params.input,
      context: params.context,
    },
    conversationId: params.conversationId,
    metadata: {
      timeoutMs: params.timeoutMs || 60_000,
    },
  });
}
