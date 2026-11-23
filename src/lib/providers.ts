/**
 * The AI providers an agent can run on: what each is called, the models to
 * suggest, and the OpenAI-compatible services that share one connector. Shared
 * by the server (lib/models) and the browser (the builder, Connections, Usage),
 * so it imports nothing.
 *
 * Gemini is the default: an agent that names no provider runs on it. Agents saved
 * before providers were offered may carry an old `engine` field; it is ignored.
 */

export type ProviderId = "gemini" | "anthropic" | "openai" | "azure_openai" | "openai_compatible";

export const PROVIDER_IDS: ProviderId[] = ["gemini", "anthropic", "openai", "azure_openai", "openai_compatible"];
export const DEFAULT_PROVIDER: ProviderId = "gemini";

export type ModelChoice = { id: string; note: string };

export const PROVIDERS: Record<
  ProviderId,
  {
    label: string;
    /** Models to suggest; any other model id the provider serves can be typed in. */
    models: ModelChoice[];
    /** A built-in web search the web-search action can use on this provider's key. */
    webSearch: boolean;
    /** One connection per workspace (the others may have several, e.g. Groq and Mistral). */
    single: boolean;
  }
> = {
  gemini: {
    label: "Google Gemini",
    models: [
      { id: "gemini-2.5-pro", note: "strongest — for long, multi-step work" },
      { id: "gemini-2.5-flash", note: "cheap — for short, simple work" },
      { id: "gemini-2.5-flash-lite", note: "cheapest" },
    ],
    webSearch: true,
    single: true,
  },
  anthropic: {
    label: "Anthropic (Claude)",
    models: [
      { id: "claude-sonnet-5-5", note: "balanced" },
      { id: "claude-opus-5-5", note: "strongest, costs more" },
      { id: "claude-fable-5-1", note: "most capable, costs most" },
      { id: "claude-haiku-4-5-20251001", note: "fastest, cheapest" },
    ],
    webSearch: true,
    single: true,
  },
  openai: {
    label: "OpenAI",
    models: [
      { id: "gpt-4.1", note: "strong all-rounder" },
      { id: "gpt-4.1-mini", note: "cheaper, fast" },
      { id: "gpt-4o", note: "general purpose" },
      { id: "gpt-4o-mini", note: "cheapest" },
      { id: "o4-mini", note: "reasoning" },
    ],
    webSearch: true,
    single: true,
  },
  azure_openai: {
    label: "Azure OpenAI",
    // The model is the deployment set on the connection.
    models: [],
    webSearch: false,
    single: true,
  },
  openai_compatible: {
    label: "OpenAI-compatible",
    models: [],
    webSearch: false,
    single: false,
  },
};

/** Services that speak the OpenAI API, offered as presets on the OpenAI-compatible connector. */
export const COMPATIBLE_PRESETS: { id: string; label: string; baseUrl: string; models: string[] }[] = [
  { id: "mistral", label: "Mistral", baseUrl: "https://api.mistral.ai/v1", models: ["mistral-large-latest", "mistral-small-latest"] },
  { id: "groq", label: "Groq", baseUrl: "https://api.groq.com/openai/v1", models: ["llama-3.3-70b-versatile"] },
  { id: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", models: ["deepseek-chat"] },
  { id: "xai", label: "xAI (Grok)", baseUrl: "https://api.x.ai/v1", models: ["grok-3", "grok-3-mini"] },
  { id: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", models: ["openai/gpt-4.1", "anthropic/claude-sonnet-4"] },
  { id: "together", label: "Together AI", baseUrl: "https://api.together.xyz/v1", models: ["meta-llama/Llama-3.3-70B-Instruct-Turbo"] },
  { id: "ollama", label: "Ollama (self-hosted)", baseUrl: "http://localhost:11434/v1", models: ["llama3.1"] },
  { id: "custom", label: "Other (enter its address)", baseUrl: "", models: [] },
];

/** A provider this workspace has a key for, as the builder lists it. */
export type EngineInfo = { id: ProviderId; label: string; model: string; connectionId?: string; connectionName?: string; preset?: string };

export const isProvider = (v: unknown): v is ProviderId => typeof v === "string" && (PROVIDER_IDS as string[]).includes(v);

/** The provider an agent runs on: its own choice, else Gemini. */
export function providerOf(spec: { provider?: string } | null | undefined): ProviderId {
  return isProvider(spec?.provider) ? spec!.provider : DEFAULT_PROVIDER;
}

/** Model suggestions for a provider; for an OpenAI-compatible connection, its preset's. */
export function suggestedModels(provider: ProviderId, preset?: string): string[] {
  if (provider === "openai_compatible") return COMPATIBLE_PRESETS.find((p) => p.id === preset)?.models ?? [];
  return PROVIDERS[provider].models.map((m) => m.id);
}
