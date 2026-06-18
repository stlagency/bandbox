'use client';

/**
 * SourceStamp — inline Space Mono provenance tag, e.g. "[OPA · 2026-06-12]"
 * (DESIGN.md §Source stamp). Clicking/Enter expands the originating record in
 * the context rail (no modal). Mirrors the mockup `openSource`.
 *
 * Pass either a known short `code` (opa/rtt/li/rev/sheriff → resolved label) or
 * an explicit `label`. In production the click resolves the parcel's actual
 * `source_url` (carried on every Sourced<T> / *Component, PRD §6); here we hand
 * the rail a human label + the optional href.
 */
import { useRail, SOURCE_LABELS } from './ContextRail';

export interface SourceStampProps {
  /** Display text inside the stamp, e.g. "[OPA · 2026-06-12]". */
  children: React.ReactNode;
  /** Known short code for the rail label. */
  code?: keyof typeof SOURCE_LABELS;
  /** Explicit rail label (overrides code). */
  label?: string;
  /** Originating public-record href (defaults to Atlas in the rail). */
  href?: string;
  /** Render as a dotted value instead of the muted stamp style. */
  dotted?: boolean;
}

export function SourceStamp({ children, code, label, href, dotted }: SourceStampProps) {
  const rail = useRail();
  const resolved = label ?? (code ? SOURCE_LABELS[code] : undefined) ?? 'Public record';

  function open() {
    rail.openSource(resolved, href);
  }

  return (
    <button
      type="button"
      className={dotted ? 'pb-dotted' : 'pb-src'}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          open();
        }
      }}
      style={
        dotted
          ? { background: 'none', border: 0, padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer' }
          : undefined
      }
    >
      {children}
    </button>
  );
}
