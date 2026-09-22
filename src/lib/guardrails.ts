/**
 * Enterprise Guardrails & Data Loss Prevention (DLP) Engine
 * 
 * Provides automated PII redaction (credit cards, emails, secrets, credentials),
 * per-agent rate limiting, and custom regex guardrail policies.
 */

export interface DLPOptions {
  enabled?: boolean;
  redactCreditCards?: boolean;
  redactEmails?: boolean;
  redactCredentials?: boolean;
  redactPhoneNumbers?: boolean;
  customPatterns?: { name: string; pattern: string; replacement: string }[];
}

export interface DLPDetection {
  type: "credit_card" | "email" | "credential" | "phone" | "custom";
  name: string;
  count: number;
}

export interface DLPMaskResult {
  text: string;
  detections: DLPDetection[];
  hasRedactions: boolean;
}

// Common Regex Patterns for Enterprise DLP
const CREDIT_CARD_REGEX = /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|6(?:011|5[0-9][0-9])[0-9]{12}|3[47][0-9]{13}|3(?:0[0-5]|[68][0-9])[0-9]{11}|(?:2131|1800|35\d{3})\d{11})\b/g;
const GENERIC_CC_REGEX = /\b(?:\d{4}[ -]?){3}\d{4}\b/g;

const EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,7}\b/g;

// High-entropy credentials, API keys, Bearer tokens, private keys
const API_KEY_PATTERNS = [
  { name: "Bearer Token", regex: /Bearer\s+[A-Za-z0-9_\-\.]{20,}/g },
  { name: "Anthropic / OpenAI API Key", regex: /\b(sk-(?:ant|proj|live)?[a-zA-Z0-9_\-]{20,})\b/g },
  { name: "GitHub Token", regex: /\b(gh[pousr]_[A-Za-z0-9_]{36,})\b/g },
  { name: "AWS Access Key", regex: /\b(AKIA[0-9A-Z]{16})\b/g },
  { name: "Generic Secret / Key", regex: /(?:api[_-]?key|secret|password|token)["']?\s*[:=]\s*["']([A-Za-z0-9_\-!@#$%^&*]{16,})["']/gi },
  { name: "RSA / Private Key Block", regex: /-----BEGIN [A-Z ]+PRIVATE KEY-----[^-]+-----END [A-Z ]+PRIVATE KEY-----/gs },
];

const PHONE_REGEX = /\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g;
const SSN_REGEX = /\b\d{3}[-]?\d{2}[-]?\d{4}\b/g;

/**
 * Redact sensitive PII, credentials, and custom expressions from text
 */
export function maskPII(text: string, options: DLPOptions = {}): DLPMaskResult {
  if (!options.enabled || !text) {
    return { text, detections: [], hasRedactions: false };
  }

  let masked = text;
  const detections: DLPDetection[] = [];

  // 1. Credit Cards
  if (options.redactCreditCards !== false) {
    let ccCount = 0;
    masked = masked.replace(CREDIT_CARD_REGEX, (match) => {
      ccCount++;
      const last4 = match.replace(/\D/g, "").slice(-4);
      return `[REDACTED_CC:•••• ${last4}]`;
    });
    masked = masked.replace(GENERIC_CC_REGEX, (match) => {
      ccCount++;
      const last4 = match.replace(/\D/g, "").slice(-4);
      return `[REDACTED_CC:•••• ${last4}]`;
    });
    if (ccCount > 0) {
      detections.push({ type: "credit_card", name: "Credit Card", count: ccCount });
    }
  }

  // 2. Email Addresses
  if (options.redactEmails !== false) {
    let emailCount = 0;
    masked = masked.replace(EMAIL_REGEX, (match) => {
      emailCount++;
      const parts = match.split("@");
      const domain = parts[1] || "domain.com";
      return `[REDACTED_EMAIL:••••@${domain}]`;
    });
    if (emailCount > 0) {
      detections.push({ type: "email", name: "Email Address", count: emailCount });
    }
  }

  // 3. Credentials & API Keys
  if (options.redactCredentials !== false) {
    let credCount = 0;
    for (const pattern of API_KEY_PATTERNS) {
      masked = masked.replace(pattern.regex, () => {
        credCount++;
        return `[REDACTED_${pattern.name.toUpperCase().replace(/\s+/g, "_")}]`;
      });
    }
    if (credCount > 0) {
      detections.push({ type: "credential", name: "API Key / Secret Token", count: credCount });
    }
  }

  // 4. Phone Numbers & SSN
  if (options.redactPhoneNumbers !== false) {
    let phoneCount = 0;
    masked = masked.replace(PHONE_REGEX, () => {
      phoneCount++;
      return `[REDACTED_PHONE]`;
    });
    masked = masked.replace(SSN_REGEX, () => {
      phoneCount++;
      return `[REDACTED_SSN]`;
    });
    if (phoneCount > 0) {
      detections.push({ type: "phone", name: "Phone / SSN", count: phoneCount });
    }
  }

  // 5. Custom Patterns
  if (options.customPatterns && Array.isArray(options.customPatterns)) {
    for (const custom of options.customPatterns) {
      try {
        const regex = new RegExp(custom.pattern, "gi");
        let count = 0;
        masked = masked.replace(regex, () => {
          count++;
          return custom.replacement || `[REDACTED_${custom.name.toUpperCase()}]`;
        });
        if (count > 0) {
          detections.push({ type: "custom", name: custom.name, count });
        }
      } catch (err) {
        console.warn(`[DLP] Invalid custom regex pattern: "${custom.pattern}"`, err);
      }
    }
  }

  return {
    text: masked,
    detections,
    hasRedactions: detections.length > 0,
  };
}

/**
 * Per-Agent In-Memory Sliding Window Rate Limiter
 */
interface RateLimitBucket {
  timestamps: number[];
  tokenCount: number;
  lastReset: number;
}

const rateLimitStore = new Map<string, RateLimitBucket>();

export interface RateLimitResult {
  allowed: boolean;
  remainingRpm: number;
  remainingTpm?: number;
  retryAfterSeconds: number;
}

/**
 * Enforce sliding-window rate limit for an agent
 * @param agentId Agent identifier
 * @param limitRpm Maximum allowed requests per minute (default: 60)
 * @param limitTpm Maximum allowed tokens per minute (optional, e.g. 100,000)
 * @param estimatedTokens Tokens consumed by this request
 */
export function checkRateLimit(
  agentId: string,
  limitRpm = 60,
  limitTpm?: number,
  estimatedTokens = 0
): RateLimitResult {
  const now = Date.now();
  const windowMs = 60 * 1000;

  let bucket = rateLimitStore.get(agentId);
  if (!bucket) {
    bucket = { timestamps: [], tokenCount: 0, lastReset: now };
    rateLimitStore.set(agentId, bucket);
  }

  // Evict timestamps older than 60s
  bucket.timestamps = bucket.timestamps.filter((ts) => now - ts < windowMs);

  // Reset token counter if window passed
  if (now - bucket.lastReset >= windowMs) {
    bucket.tokenCount = 0;
    bucket.lastReset = now;
  }

  const currentRequests = bucket.timestamps.length;
  const currentTokens = bucket.tokenCount;

  // Check RPM
  if (limitRpm > 0 && currentRequests >= limitRpm) {
    const oldest = bucket.timestamps[0] || now;
    const retryAfter = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    return {
      allowed: false,
      remainingRpm: 0,
      retryAfterSeconds: retryAfter,
    };
  }

  // Check TPM if set
  if (limitTpm && limitTpm > 0 && currentTokens + estimatedTokens > limitTpm) {
    const retryAfter = Math.max(1, Math.ceil((bucket.lastReset + windowMs - now) / 1000));
    return {
      allowed: false,
      remainingRpm: Math.max(0, limitRpm - currentRequests),
      remainingTpm: 0,
      retryAfterSeconds: retryAfter,
    };
  }

  // Record this request
  bucket.timestamps.push(now);
  bucket.tokenCount += estimatedTokens;

  return {
    allowed: true,
    remainingRpm: Math.max(0, limitRpm - bucket.timestamps.length),
    remainingTpm: limitTpm ? Math.max(0, limitTpm - bucket.tokenCount) : undefined,
    retryAfterSeconds: 0,
  };
}
