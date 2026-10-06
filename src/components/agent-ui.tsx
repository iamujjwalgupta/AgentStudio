/**
 * Small pieces the Agents list and the agent page share, so an agent looks the
 * same in both: line icons, the colour of a process code, and the industry and
 * process tags read out of a domain.
 */

// ---- icons: thin stroke, inheriting colour so button states drive them ----------
export const Svg = ({ children, size = 15 }: { children: React.ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {children}
  </svg>
);
type IconProps = { size?: number };
export const TrashIcon = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M2.6 4.2h10.8" />
    <path d="M6.5 4.2V2.9c0-.45.35-.8.8-.8h1.4c.45 0 .8.35.8.8v1.3" />
    <path d="M12.1 4.2l-.45 8.5c-.03.75-.6 1.3-1.3 1.3H5.65c-.7 0-1.27-.55-1.3-1.3L3.9 4.2" />
    <path d="M6.65 6.9v4.2M9.35 6.9v4.2" />
  </Svg>
);
export const ShareIcon = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M8 10.4V2.2" />
    <path d="M5.2 4.9L8 2.1l2.8 2.8" />
    <path d="M3.2 8.6v4.1c0 .65.5 1.2 1.15 1.2h7.3c.65 0 1.15-.55 1.15-1.2V8.6" />
  </Svg>
);
export const ArchiveIcon = ({ size }: IconProps) => (
  <Svg size={size}>
    <rect x="2.3" y="2.6" width="11.4" height="3.1" rx="0.8" />
    <path d="M3.4 5.7v6.6c0 .6.5 1.1 1.1 1.1h7c.6 0 1.1-.5 1.1-1.1V5.7" />
    <path d="M6.5 8.4h3" />
  </Svg>
);
export const RestoreIcon = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M3 8a5 5 0 1 0 1.5-3.6" />
    <path d="M2.6 2.9v2.9h2.9" />
  </Svg>
);
export const RunIcon = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M5.4 3.4l6.4 4.6-6.4 4.6z" />
  </Svg>
);
export const ExportIcon = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M8 2.5v7.5M5 7.5l3 3 3-3M2.5 12.5h11" />
  </Svg>
);
export const CloudIcon = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M4.6 12.6h7.1a2.9 2.9 0 0 0 .4-5.8 4 4 0 0 0-7.7.9 2.5 2.5 0 0 0 .2 4.9z" />
    <path d="M8 11V7.4M6.5 8.8L8 7.3l1.5 1.5" />
  </Svg>
);
export const EyeIcon = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8z" />
    <circle cx="8" cy="8" r="1.9" />
  </Svg>
);
export const MoreIcon = ({ size }: IconProps) => (
  <Svg size={size}>
    <circle cx="3.5" cy="8" r=".9" fill="currentColor" />
    <circle cx="8" cy="8" r=".9" fill="currentColor" />
    <circle cx="12.5" cy="8" r=".9" fill="currentColor" />
  </Svg>
);
export const CheckIcon = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M3.2 8.4l3 3 6.6-6.8" />
  </Svg>
);
export const CrossIcon = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6" />
  </Svg>
);
export const AlertIcon = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M8 2.2l6.2 11H1.8z" />
    <path d="M8 6.4v3M8 11.3v.1" />
  </Svg>
);
export const ClockIcon = ({ size }: IconProps) => (
  <Svg size={size}>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 4.8V8l2.2 1.5" />
  </Svg>
);
export const ShieldIcon = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M8 1.8l5 1.9v3.9c0 3.1-2.1 5.6-5 6.6-2.9-1-5-3.5-5-6.6V3.7z" />
  </Svg>
);
export const SparkIcon = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M8 1.8l1.4 4.1 4.1 1.4-4.1 1.4L8 12.8l-1.4-4.1-4.1-1.4 4.1-1.4z" />
  </Svg>
);
export const SearchIcon = ({ size }: IconProps) => (
  <Svg size={size}>
    <circle cx="7" cy="7" r="4.3" />
    <path d="M10.2 10.2l3.4 3.4" />
  </Svg>
);
export const ArrowLeftIcon = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M13 8H3.2M7.2 4L3.2 8l4 4" />
  </Svg>
);
export const ArrowRightIcon = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M3 8h9.8M8.8 4l4 4-4 4" />
  </Svg>
);
export const PencilIcon = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M10.6 2.8l2.6 2.6-7.6 7.6H3v-2.6z" />
    <path d="M9.2 4.2l2.6 2.6" />
  </Svg>
);
export const GridIcon = ({ size }: IconProps) => (
  <Svg size={size}>
    <rect x="2.4" y="2.4" width="4.4" height="4.4" rx="1" />
    <rect x="9.2" y="2.4" width="4.4" height="4.4" rx="1" />
    <rect x="2.4" y="9.2" width="4.4" height="4.4" rx="1" />
    <rect x="9.2" y="9.2" width="4.4" height="4.4" rx="1" />
  </Svg>
);
export const ListIcon = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M5.5 4h8M5.5 8h8M5.5 12h8" />
    <circle cx="2.7" cy="4" r=".6" fill="currentColor" />
    <circle cx="2.7" cy="8" r=".6" fill="currentColor" />
    <circle cx="2.7" cy="12" r=".6" fill="currentColor" />
  </Svg>
);
export const LayersIcon = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M8 2.2l6 3.2-6 3.2-6-3.2z" />
    <path d="M2 8.6l6 3.2 6-3.2" />
  </Svg>
);
export const WrenchIcon = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M10.4 2.3a3.2 3.2 0 0 0-3.9 4.1L2.4 10.5a1.3 1.3 0 0 0 1.9 1.9l4.1-4.1a3.2 3.2 0 0 0 4.1-3.9l-2 2-1.8-.3-.3-1.8z" />
  </Svg>
);

/** A stable colour per process code, so R2R looks the same everywhere. */
const PROCESS_COLOURS = ["#00338D", "#0091DA", "#00A3A1", "#483698", "#6D2077", "#005EB8", "#00843D", "#E05206", "#1E49E2", "#470A68"];
export function processColour(code: string | null): string {
  if (!code) return "#7f8fa9";
  let h = 0;
  for (const ch of code) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PROCESS_COLOURS[h % PROCESS_COLOURS.length];
}

export type DomainParts = { domain: string | null; industry: string | null; process: string | null; process_name: string | null };

/**
 * "Automobile · P2P (Vendor Payment Excise)" split the way the list's SQL splits
 * it (see lib/agent-list.ts), so both read a domain the same way.
 */
export function parseDomain(domain: string | null | undefined): DomainParts {
  const d = (domain ?? "").trim();
  if (!d) return { domain: null, industry: null, process: null, process_name: null };
  const head = d.split(" · ")[0];
  return {
    domain: d,
    industry: head !== d ? head : null,
    process: d.match(/· *([A-Za-z0-9]{2,6}) *(?:\(|$)/)?.[1] ?? null,
    process_name: d.match(/· *[A-Za-z0-9]{2,6} *\(([^)]*)\)/)?.[1] ?? null,
  };
}

/** Industry and process as small tags; a free-text domain as a single tag. */
export function DomainTags({ a }: { a: DomainParts }) {
  if (!a.industry && !a.process) {
    return a.domain ? <span className="al-tag" title={a.domain}>{a.domain}</span> : <span className="dim">—</span>;
  }
  return (
    <span className="al-tags">
      {a.industry && <span className="al-tag" title={a.industry}>{a.industry}</span>}
      {a.process && (
        <span
          className="al-tag al-proc"
          style={{ ["--pc" as any]: processColour(a.process) }}
          title={a.process_name ? `${a.process} — ${a.process_name}` : a.process}
        >
          {a.process}
        </span>
      )}
    </span>
  );
}
export const DocIcon = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M4 1.8h5.2L12.4 5v9.2H4z" />
    <path d="M9 1.8V5.2h3.4M6 8h4.4M6 10.6h4.4" />
  </Svg>
);
export const TableIcon = ({ size }: IconProps) => (
  <Svg size={size}>
    <rect x="2" y="2.8" width="12" height="10.4" rx="1.4" />
    <path d="M2 6.3h12M2 9.8h12M6.2 2.8v10.4" />
  </Svg>
);
export const MailIcon = ({ size }: IconProps) => (
  <Svg size={size}>
    <rect x="1.8" y="3.2" width="12.4" height="9.6" rx="1.4" />
    <path d="M2.2 4l5.8 4.6L13.8 4" />
  </Svg>
);
export const ChatIcon = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M2.4 3.2h11.2v7.4H7.4L4.2 13.2v-2.6H2.4z" />
  </Svg>
);
export const BracesIcon = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M5.6 2.4c-1.4 0-1.9.6-1.9 1.8v1.7c0 .9-.5 1.6-1.4 2.1.9.5 1.4 1.2 1.4 2.1v1.7c0 1.2.5 1.8 1.9 1.8" />
    <path d="M10.4 2.4c1.4 0 1.9.6 1.9 1.8v1.7c0 .9.5 1.6 1.4 2.1-.9.5-1.4 1.2-1.4 2.1v1.7c0 1.2-.5 1.8-1.9 1.8" />
  </Svg>
);
export const BookIcon = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M2.4 3.2c1.9-.8 3.8-.8 5.6.4 1.8-1.2 3.7-1.2 5.6-.4v9.6c-1.9-.8-3.8-.8-5.6.4-1.8-1.2-3.7-1.2-5.6-.4z" />
    <path d="M8 3.6v9.6" />
  </Svg>
);
export const ChevronIcon = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M4.5 6.2L8 9.8l3.5-3.6" />
  </Svg>
);
export const CalendarIcon = ({ size }: IconProps) => (
  <Svg size={size}>
    <rect x="2.2" y="3.2" width="11.6" height="10.6" rx="1.6" />
    <path d="M2.2 6.6h11.6M5.4 1.8v2.6M10.6 1.8v2.6" />
  </Svg>
);
export const UploadIcon = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M8 10.5V2.6M5 5.4l3-2.9 3 2.9M2.6 10.4v2.2c0 .6.5 1.1 1.1 1.1h8.6c.6 0 1.1-.5 1.1-1.1v-2.2" />
  </Svg>
);
export const PlugIcon = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M5.6 1.8v3M10.4 1.8v3M3.8 4.8h8.4v2.4a4.2 4.2 0 0 1-8.4 0zM8 11.4v2.8" />
  </Svg>
);
export const FormIcon = ({ size }: IconProps) => (
  <Svg size={size}>
    <rect x="2.2" y="1.8" width="11.6" height="12.4" rx="1.6" />
    <path d="M4.8 5h6.4M4.8 8h6.4M4.8 11h3.6" />
  </Svg>
);
export const CopyIcon = ({ size }: IconProps) => (
  <Svg size={size}>
    <rect x="5.4" y="5.4" width="8.4" height="8.4" rx="1.4" />
    <path d="M10.6 5.4V3.6c0-.8-.6-1.4-1.4-1.4H3.6c-.8 0-1.4.6-1.4 1.4v5.6c0 .8.6 1.4 1.4 1.4h1.8" />
  </Svg>
);
