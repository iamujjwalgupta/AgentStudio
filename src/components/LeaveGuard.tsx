"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Asks before leaving a page that holds unsaved work.
 *
 * In-app links (the back link, the sidebar, anything else) are caught before
 * Next.js follows them and the destination is handed back as `to`, so the page
 * can offer to save first. Reloading or closing the tab gets the browser's own
 * "leave site?" prompt, which is all a page is allowed to show there.
 */
export function useLeaveGuard(active: boolean) {
  const [to, setTo] = useState<string | null>(null);
  const released = useRef(false);

  useEffect(() => {
    if (!active) return;
    const onClick = (e: MouseEvent) => {
      if (released.current || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
      // Capture phase on the document runs before React's handlers, so the Link never navigates.
      e.preventDefault();
      e.stopPropagation();
      setTo(url.pathname + url.search + url.hash);
    };
    const onUnload = (e: BeforeUnloadEvent) => {
      if (released.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    document.addEventListener("click", onClick, true);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, [active]);

  return {
    /** Where the person was going when they were stopped, or null. */
    to,
    /** Ask as if a link to `href` had been clicked. */
    ask: (href: string) => setTo(href),
    cancel: () => setTo(null),
    /** Stop guarding, just before navigating away on purpose. */
    release: () => {
      released.current = true;
    },
  };
}

export function SaveDraftDialog({
  busy,
  error,
  onSave,
  onDiscard,
  onCancel,
}: {
  busy: boolean;
  error: string;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && !busy && onCancel();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [busy, onCancel]);

  return (
    <div className="modal-back" onMouseDown={() => !busy && onCancel()}>
      <div className="panel modal" role="dialog" aria-modal="true" aria-labelledby="save-draft-title" onMouseDown={(e) => e.stopPropagation()}>
        <div className="eyebrow">Unsaved agent</div>
        <h2 id="save-draft-title" style={{ margin: "2px 0 6px", fontSize: 17 }}>
          Save this agent as a draft?
        </h2>
        <p className="help" style={{ marginTop: 0 }}>
          It has not been saved yet. Save it as a draft to come back to it later from the Agents list, or discard it and
          nothing is kept.
        </p>
        {error && <div className="error" style={{ marginTop: 12 }}>{error}</div>}
        <div className="panel-foot">
          <button className="btn" onClick={onCancel} disabled={busy}>Keep editing</button>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-danger" onClick={onDiscard} disabled={busy}>Discard</button>
            <button className="btn btn-primary" onClick={onSave} disabled={busy} autoFocus>
              {busy && <span className="spin" />}
              {busy ? "Saving…" : "Save as draft"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
