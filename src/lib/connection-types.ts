/**
 * The kinds of connection this application can use, and what each one asks for.
 *
 * A connection is only useful if an agent action reads it (lib/tools.ts, where
 * each tool names the kind it `needs`), or if the platform itself does (the model
 * keys). This list is the single source for what the Connections page offers,
 * what the API accepts, and what the agent builder links to, so a connection can
 * never be created under a name no action recognises.
 *
 * The fields are exactly what the actions read from `config`; the secret is what
 * they read from the encrypted secret.
 */

export type FieldDef = {
  key: string;
  label: string;
  hint: string;
  /** Optional fields may be left empty. */
  optional?: boolean;
  kind?: "text" | "number" | "checkbox";
};

export type ConnectionType = {
  kind: string;
  label: string;
  group: "data" | "messaging" | "work" | "model";
  description: string;
  fields: FieldDef[];
  secret: { label: string; hint: string; optional?: boolean };
  /** What the Test button does, when there is one. */
  test?: string;
};

export const CONNECTION_GROUPS: { id: ConnectionType["group"]; title: string; note: string }[] = [
  { id: "data", title: "Data", note: "Databases, services and files agents read from or write to" },
  { id: "messaging", title: "Messaging", note: "Where agents send emails and posts" },
  { id: "work", title: "Work tracking and code", note: "Tickets and repositories" },
  { id: "model", title: "AI model keys", note: "What runs the agents and the sandbox" },
];

export const CONNECTION_TYPES: ConnectionType[] = [
  {
    kind: "postgres",
    label: "PostgreSQL database",
    group: "data",
    description: "A Postgres database agents can query, and write to where allowed.",
    fields: [
      {
        key: "allowWrites",
        label: "Allow write statements",
        hint: "Lets the “Execute SQL write statement” action run INSERT, UPDATE and DELETE here. Agents still need that action granted, and it waits for approval. Keep the database login’s own permissions narrow too.",
        kind: "checkbox",
        optional: true,
      },
    ],
    secret: { label: "Connection string", hint: "postgresql://user:password@host:5432/database" },
    test: "Test connection",
  },
  {
    kind: "http",
    label: "REST API",
    group: "data",
    description: "An HTTP service or portal agents call. Credentials are added by the platform.",
    fields: [{ key: "baseUrl", label: "Base URL", hint: "https://api.example.com/v1" }],
    secret: { label: "Bearer token", hint: "Sent as Authorization: Bearer …", optional: true },
    test: "Test connection",
  },
  {
    kind: "s3",
    label: "File storage (S3)",
    group: "data",
    description: "An S3 or S3-compatible bucket agents upload files to.",
    fields: [
      { key: "bucket", label: "Bucket", hint: "finance-reports" },
      { key: "region", label: "Region", hint: "us-east-1" },
      { key: "accessKeyId", label: "Access key ID", hint: "AKIA…" },
      { key: "endpoint", label: "Custom endpoint", hint: "https://<account>.r2.cloudflarestorage.com", optional: true },
    ],
    secret: { label: "Secret access key", hint: "The secret for the access key above" },
    test: "Test connection",
  },
  {
    kind: "redis",
    label: "Key–value store (Redis)",
    group: "data",
    description: "A Redis store agents read and write small values to between runs.",
    fields: [
      { key: "host", label: "Host", hint: "redis.internal" },
      { key: "port", label: "Port", hint: "6379", kind: "number" },
      { key: "keyPrefix", label: "Key prefix", hint: "agent-studio", optional: true },
      { key: "tls", label: "Use TLS", hint: "", kind: "checkbox", optional: true },
    ],
    secret: { label: "Password", hint: "Leave empty if the store has none", optional: true },
  },
  {
    kind: "smtp",
    label: "Email (SMTP)",
    group: "messaging",
    description: "A mail server agents send email through, such as Outlook / Exchange.",
    fields: [
      { key: "host", label: "SMTP host", hint: "smtp.office365.com" },
      { key: "port", label: "Port", hint: "587", kind: "number" },
      { key: "user", label: "Username", hint: "agent-mailer@company.com" },
      { key: "from", label: "Send as", hint: "Finance Agents <agents@company.com>", optional: true },
      { key: "secure", label: "Use TLS from the start (port 465)", hint: "", kind: "checkbox", optional: true },
    ],
    secret: { label: "Password", hint: "The mailbox password or app password" },
    test: "Check the login",
  },
  {
    kind: "slack",
    label: "Slack",
    group: "messaging",
    description: "A Slack channel agents post to, through an incoming webhook.",
    fields: [{ key: "channel", label: "Channel name", hint: "#finance-alerts", optional: true }],
    secret: { label: "Incoming webhook URL", hint: "https://hooks.slack.com/services/…" },
    test: "Send a test message",
  },
  {
    kind: "msteams",
    label: "Microsoft Teams",
    group: "messaging",
    description: "A Teams channel agents post to, through an incoming webhook.",
    fields: [{ key: "channel", label: "Channel name", hint: "Finance Ops › Alerts", optional: true }],
    secret: { label: "Incoming webhook URL", hint: "https://…webhook.office.com/…" },
    test: "Send a test message",
  },
  {
    kind: "jira",
    label: "Jira",
    group: "work",
    description: "A Jira site agents search and raise issues in.",
    fields: [
      { key: "host", label: "Site URL", hint: "https://your-org.atlassian.net" },
      { key: "email", label: "Account email", hint: "service-account@company.com" },
      { key: "project", label: "Default project key", hint: "FIN", optional: true },
    ],
    secret: { label: "API token", hint: "From id.atlassian.com › Security › API tokens" },
    test: "Test connection",
  },
  {
    kind: "github",
    label: "GitHub",
    group: "work",
    description: "A GitHub account agents read files and raise issues with.",
    fields: [{ key: "repo", label: "Default repository", hint: "owner/repo", optional: true }],
    secret: { label: "Access token", hint: "A fine-grained token with the repositories it needs" },
    test: "Test connection",
  },
  {
    kind: "anthropic",
    label: "Anthropic (Claude)",
    group: "model",
    description: "The model key every agent run uses. Required: agents cannot run without it.",
    fields: [{ key: "model", label: "Model", hint: "claude-sonnet-4-6 (the default)", optional: true }],
    secret: { label: "API key", hint: "sk-ant-…" },
    test: "Test the key",
  },
  {
    kind: "gemini",
    label: "Google Gemini",
    group: "model",
    description: "The model key the Google ADK sandbox uses.",
    fields: [{ key: "model", label: "Model", hint: "gemini-2.5-flash", optional: true }],
    secret: { label: "API key", hint: "From Google AI Studio" },
    test: "Test the key",
  },
];

export const USABLE_KINDS = new Set(CONNECTION_TYPES.map((t) => t.kind));
/** Only one of these per workspace: the platform reads the first it finds. */
export const SINGLE_KINDS = new Set(["anthropic", "gemini"]);

export const typeOf = (kind: string) => CONNECTION_TYPES.find((t) => t.kind === kind);
export const kindLabel = (kind: string) => typeOf(kind)?.label ?? kind;

/** What is still missing for a connection of this kind, or "" when it is complete. */
export function missingFor(kind: string, config: Record<string, any>, hasSecret: boolean): string {
  const t = typeOf(kind);
  if (!t) return "";
  const field = t.fields.find((f) => !f.optional && f.kind !== "checkbox" && !String(config?.[f.key] ?? "").trim());
  if (field) return `Fill in ${field.label.toLowerCase()}.`;
  if (!t.secret.optional && !hasSecret) return `Paste the ${t.secret.label.toLowerCase()}.`;
  return "";
}
