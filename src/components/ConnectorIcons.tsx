import React from "react";

interface IconProps {
  size?: number;
  className?: string;
}

export function ConnectorIcon({ id, size = 32, className = "" }: { id: string; size?: number; className?: string }) {
  switch (id) {
    case "google_drive":
      return (
        <svg width={size} height={size} viewBox="0 0 87.3 78" className={className}>
          <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H0c0 1.55.4 3.1 1.2 4.5z" fill="#0066da" />
          <path d="M43.65 25 29.9 1.2C28.55 2 27.4 3.1 26.6 4.5L1.2 48.55c-.8 1.4-1.2 2.95-1.2 4.5h27.5z" fill="#00ac47" />
          <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.8l5.85 10.1z" fill="#ea4335" />
          <path d="M43.65 25 57.4 1.2C56.05.4 54.5 0 52.9 0H34.4c-1.6 0-3.15.4-4.5 1.2z" fill="#00832d" />
          <path d="m59.8 53.1-16.15-28-16.15 28z" fill="#2684fc" />
          <path d="m73.55 76.8-13.75-23.7H27.5L41.25 76.8c1.35.8 2.9 1.2 4.5 1.2h23.3c1.6 0 3.15-.4 4.5-1.2z" fill="#ffba00" />
        </svg>
      );

    case "gmail":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
          <path fill="#4285f4" d="M1.5 19.5h3v-10l-3-2.25z" />
          <path fill="#34a853" d="M19.5 19.5h3v-10l-3-2.25z" />
          <path fill="#ea4335" d="M19.5 4.5l-7.5 5.625L4.5 4.5H1.5v2.25l10.5 7.875 10.5-7.875V4.5z" />
          <path fill="#fbbc04" d="M19.5 4.5V7.5L12 13.125 4.5 7.5V4.5H1.5c-.825 0-1.5.675-1.5 1.5v12c0 .825.675 1.5 1.5 1.5h3V9.5l7.5 5.625 7.5-5.625v10h3c.825 0 1.5-.675 1.5-1.5V6c0-.825-.675-1.5-1.5-1.5h-3z" opacity=".2" />
          <path fill="#c5221f" d="M4.5 4.5l7.5 5.625L19.5 4.5h-15z" />
        </svg>
      );

    case "google_calendar":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
          <rect width="24" height="24" rx="4" fill="#ffffff" />
          <path fill="#4285f4" d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11z" />
          <text x="12" y="17" fill="#4285f4" fontSize="8" fontWeight="bold" textAnchor="middle" fontFamily="sans-serif">31</text>
        </svg>
      );

    case "canva":
      return (
        <svg width={size} height={size} viewBox="0 0 32 32" className={className}>
          <defs>
            <linearGradient id="canva-grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#00c4cc" />
              <stop offset="100%" stopColor="#7d2ae8" />
            </linearGradient>
          </defs>
          <circle cx="16" cy="16" r="16" fill="url(#canva-grad)" />
          <path d="M12.2 19.8c-1.8 0-3.1-1.3-3.1-3.6 0-3.3 2.6-5.8 6.5-5.8 2.2 0 3.7.8 4.2 1.2l-.7 1.8c-.4-.4-1.6-1.1-3.3-1.1-2.6 0-4.3 1.7-4.3 3.8 0 1.5.9 2.1 1.9 2.1 1.6 0 2.8-1 3.5-2.2l1.6 1.1c-1.1 1.6-2.9 2.7-5.8 2.7z" fill="#ffffff" />
        </svg>
      );

    case "microsoft365":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
          <rect x="1" y="1" width="10" height="10" rx="1" fill="#f25022" />
          <rect x="13" y="1" width="10" height="10" rx="1" fill="#7fba00" />
          <rect x="1" y="13" width="10" height="10" rx="1" fill="#00a4ef" />
          <rect x="13" y="13" width="10" height="10" rx="1" fill="#ffb900" />
        </svg>
      );

    case "notion":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
          <rect width="24" height="24" rx="4" fill="#000000" />
          <path d="M6 5.5l9.2.6c.4 0 .7.3.7.7v1.2c0 .3-.2.6-.5.7l-1.5.4v9.5c0 .6-.4 1.1-1 1.1-.3 0-.6-.1-.8-.4l-5-6.8v6.2l1.5.4c.3.1.5.4.5.7v1.2c0 .4-.3.7-.7.7H4.5c-.4 0-.7-.3-.7-.7v-1.2c0-.3.2-.6.5-.7l1.5-.4V8.1L4.3 7.7c-.3-.1-.5-.4-.5-.7V5.8c0-.4.3-.7.7-.7l1.5.4zm3.7 3.5v5.8l4.4 6V9z" fill="#ffffff" />
        </svg>
      );

    case "figma":
      return (
        <svg width={size} height={size} viewBox="0 0 38 57" className={className}>
          <path d="M19 28.5a9.5 9.5 0 1 1 19 0 9.5 9.5 0 0 1-19 0z" fill="#1abcfe" />
          <path d="M0 47.5A9.5 9.5 0 0 1 9.5 38H19v9.5a9.5 9.5 0 1 1-19 0z" fill="#0acf83" />
          <path d="M19 0v19h9.5a9.5 9.5 0 1 0 0-19H19z" fill="#ff7262" />
          <path d="M0 9.5A9.5 9.5 0 0 0 9.5 19H19V0H9.5A9.5 9.5 0 0 0 0 9.5z" fill="#f24e1e" />
          <path d="M0 28.5A9.5 9.5 0 0 0 9.5 38H19V19H9.5A9.5 9.5 0 0 0 0 28.5z" fill="#a259ff" />
        </svg>
      );

    case "slack":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
          <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z" fill="#e01e5a" />
          <path d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z" fill="#36c5f0" />
          <path d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312z" fill="#2eb67d" />
          <path d="M15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" fill="#ecb22e" />
        </svg>
      );

    case "atlassian":
    case "jira":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
          <defs>
            <linearGradient id="atlassian-grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#0052cc" />
              <stop offset="100%" stopColor="#2684ff" />
            </linearGradient>
          </defs>
          <path d="M11.53 2c-.36.56-4.66 7.42-7.23 11.45A10.82 10.82 0 0 0 2.5 19.34C3.21 21 4.7 22 6.54 22h10.92c1.84 0 3.33-1 4.04-2.66.42-.98.34-2.14-.14-3.08L12.47 2a1.08 1.08 0 0 0-.94-.5z" fill="url(#atlassian-grad)" />
          <path d="M11.53 2c-.18.28-1.57 2.5-3.3 5.25a9.38 9.38 0 0 1 5.92 7.02c.32 1.7-.1 3.5-1.15 4.93L12 20.6l9.36-14.3c.48.94.56 2.1.14 3.08-.71 1.66-2.2 2.66-4.04 2.66H6.54c-1.84 0-3.33-1-4.04-2.66a5.7 5.7 0 0 1 .45-3.92C5.52 9.42 9.82 2.56 10.18 2h1.35z" fill="#ffffff" opacity=".25" />
        </svg>
      );

    case "hubspot":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
          <rect width="24" height="24" rx="4" fill="#ff7a59" />
          <path d="M18.8 9.2V6.6h-1.5v2.6a4.2 4.2 0 0 0-1.8 1.1l-5.3-4.1V4.4a1.8 1.8 0 1 0-1.8 1.8v1.6l4.9 3.8a4.2 4.2 0 0 0-1.1 2.8 4.2 4.2 0 0 0 .5 2l-6 6a1.5 1.5 0 1 0 1.1 1.1l6-6a4.2 4.2 0 0 0 2 0.5 4.2 4.2 0 0 0 4.2-4.2c0-1.1-.4-2.2-1.2-3z" fill="#ffffff" />
        </svg>
      );

    case "asana":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
          <circle cx="12" cy="7" r="4.5" fill="#f06a6a" />
          <circle cx="6.5" cy="16.5" r="4.5" fill="#f06a6a" />
          <circle cx="17.5" cy="16.5" r="4.5" fill="#f06a6a" />
        </svg>
      );

    case "linear":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
          <rect width="24" height="24" rx="5" fill="#121316" />
          <path d="M4.5 12a7.5 7.5 0 0 1 12.8-5.3l-10.6 10.6A7.47 7.47 0 0 1 4.5 12zm2.2 6.8L18.8 6.7a7.5 7.5 0 0 1-12.1 12.1z" fill="#ffffff" opacity=".85" />
        </svg>
      );

    case "mcp":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
          <rect width="24" height="24" rx="5" fill="#7c3aed" />
          <path d="M12 3L4 7.5v9L12 21l8-4.5v-9L12 3zm0 2.3l5.8 3.2L12 11.8 6.2 8.5 12 5.3zm-6 4.6l5 2.8v5.5l-5-2.8V9.9zm7 8.3v-5.5l5-2.8v5.5l-5 2.8z" fill="#ffffff" />
        </svg>
      );

    case "aivm_brain":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
          <rect width="24" height="24" rx="5" fill="#0066da" />
          <path d="M12 3L4 7.5v9L12 21l8-4.5v-9L12 3zm0 2.3l5.8 3.2L12 11.8 6.2 8.5 12 5.3zm-6 4.6l5 2.8v5.5l-5-2.8V9.9zm7 8.3v-5.5l5-2.8v5.5l-5 2.8z" fill="#ffffff" />
        </svg>
      );

    case "http":
    case "rest":
    case "api":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
          <rect width="24" height="24" rx="5" fill="#4f46e5" />
          <circle cx="12" cy="12" r="7.5" fill="none" stroke="#ffffff" strokeWidth="1.6" />
          <ellipse cx="12" cy="12" rx="3.5" ry="7.5" fill="none" stroke="#ffffff" strokeWidth="1.6" />
          <line x1="4.5" y1="12" x2="19.5" y2="12" stroke="#ffffff" strokeWidth="1.6" />
        </svg>
      );

    case "postgres":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
          <rect width="24" height="24" rx="4" fill="#336791" />
          <path d="M12 4c-3.87 0-7 1.79-7 4v8c0 2.21 3.13 4 7 4s7-1.79 7-4V8c0-2.21-3.13-4-7-4zm0 2c3.31 0 5 1.34 5 2s-1.69 2-5 2-5-1.34-5-2 1.69-2 5-2zm-5 4.5c1.19.78 3.03 1.5 5 1.5s3.81-.72 5-1.5V12c0 .66-1.69 2-5 2s-5-1.34-5-2v-1.5zm0 4c1.19.78 3.03 1.5 5 1.5s3.81-.72 5-1.5V16c0 .66-1.69 2-5 2s-5-1.34-5-2v-1.5z" fill="#ffffff" />
        </svg>
      );

    case "s3":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
          <rect width="24" height="24" rx="4" fill="#e2533a" />
          <path d="M12 3c-4.4 0-8 1.3-8 3v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6c0-1.7-3.6-3-8-3zm0 2c3.5 0 6 1 6 1.5S15.5 8 12 8 6 7 6 6.5 8.5 5 12 5zm-6 3.5c1.4.6 3.5 1 6 1s4.6-.4 6-1V10c0 .6-2.5 1.5-6 1.5S6 10.6 6 10V8.5zm0 4.5c1.4.6 3.5 1 6 1s4.6-.4 6-1V14c0 .6-2.5 1.5-6 1.5S6 14.6 6 14v-1zm0 4.5c1.4.6 3.5 1 6 1s4.6-.4 6-1V18c0 .6-2.5 1.5-6 1.5S6 18.6 6 18v-1z" fill="#ffffff" />
        </svg>
      );

    case "github":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
          <rect width="24" height="24" rx="5" fill="#181717" />
          <path d="M12 4a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38v-1.47c-2.22.48-2.69-1.07-2.69-1.07-.36-.92-.89-1.17-.89-1.17-.73-.5.05-.49.05-.49.8.06 1.23.83 1.23.83.71 1.22 1.87.87 2.33.66.07-.52.28-.87.5-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.65 7.65 0 0 1 4 0c1.53-1.03 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48v2.2c0 .22.14.46.55.38A8 8 0 0 0 12 4z" fill="#ffffff" />
        </svg>
      );

    case "anthropic":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
          <rect width="24" height="24" rx="4" fill="#d97757" />
          <path d="M13.8 6.5h-3.6L6 17.5h2.8l1-2.7h4.4l1 2.7h2.8L13.8 6.5zm-3.2 6.3l1.4-3.8 1.4 3.8h-2.8z" fill="#ffffff" />
        </svg>
      );

    case "gemini":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
          <rect width="24" height="24" rx="4" fill="#1b72e8" />
          <path d="M12 4c0 4.4-3.6 8-8 8 4.4 0 8 3.6 8 8 0-4.4 3.6-8 8-8-4.4 0-8-3.6-8-8z" fill="#ffffff" />
        </svg>
      );

    case "redis":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
          <rect width="24" height="24" rx="4" fill="#dc382d" />
          <path d="M4 8l8-4 8 4-8 4-8-4zm0 4.5l8 4 8-4v2l-8 4-8-4v-2zm0 4.5l8 4 8-4v2l-8 4-8-4v-2z" fill="#ffffff" />
        </svg>
      );

    default:
      return (
        <div
          style={{
            width: size,
            height: size,
            borderRadius: "6px",
            background: "rgba(0, 145, 218, 0.15)",
            border: "1px solid rgba(0, 145, 218, 0.3)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: `${size * 0.55}px`,
          }}
        >
          ⚡
        </div>
      );
  }
}

export function VerifiedBadge({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      style={{ display: "inline-block", verticalAlign: "middle", marginLeft: 6, flexShrink: 0 }}
    >
      <circle cx="8" cy="8" r="8" fill="#10b981" />
      <path d="M4.5 8.2L6.8 10.5L11.5 5.5" stroke="#ffffff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * The icon for a kind of connection the app uses (lib/connection-types). Email has
 * no brand, so it gets a plain envelope; Teams uses the Microsoft mark.
 */
export function KindIcon({ kind, size = 22 }: { kind: string; size?: number }) {
  if (kind === "smtp") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#00338d" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M3.5 6.5l8.5 6.5 8.5-6.5" />
      </svg>
    );
  }
  if (kind === "msteams") return <ConnectorIcon id="microsoft365" size={size} />;
  return <ConnectorIcon id={kind} size={size} />;
}
