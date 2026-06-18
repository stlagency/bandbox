/**
 * MetricStrip / MetricCell — equal-width cells split by 3px ink rules
 * (DESIGN.md §Metric block). The ONE most-important metric per card may flip
 * to solid --pb-red + white (the red-budget enforcer — at most one red cell
 * per screen, enforced by the caller, see the per-screen red accounting in
 * DESIGN.md §Red discipline). A secondary featured metric uses --pb-sky-tint.
 *
 * Two layouts:
 *  - "grid"  (deep-dive): responsive grid, `columns` per row (default 2).
 *  - "flex"  (scan rail): a bordered+shadowed flex row of cells.
 */
import type { ReactNode } from 'react';

export type MetricEmphasis = 'none' | 'featured' | 'red';

export interface MetricCellProps {
  label: ReactNode;
  /** The big mono value. */
  value: ReactNode;
  /** Sub-line under the value (e.g. "OPA · land $58k · bldg $183k"). */
  sub?: ReactNode;
  emphasis?: MetricEmphasis;
  /** Render the value with a dotted "click-to-source" underline. */
  valueTitle?: string;
}

export function MetricCell({ label, value, sub, emphasis = 'none', valueTitle }: MetricCellProps) {
  const cls = [
    'pb-metric',
    emphasis === 'red' ? 'pb-metric--red' : '',
    emphasis === 'featured' ? 'pb-metric--featured' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={cls}>
      <p className="pb-mlabel">{label}</p>
      <p className={`pb-mval${valueTitle ? ' pb-src-val' : ''}`} title={valueTitle}>
        {value}
      </p>
      {sub ? <p className="pb-msub">{sub}</p> : null}
    </div>
  );
}

export interface MetricStripProps {
  layout?: 'grid' | 'flex';
  /** Grid columns (grid layout only). */
  columns?: number;
  /** Remove the top border (for stacking two grid strips). */
  joinTop?: boolean;
  children: ReactNode;
  ariaLabel?: string;
}

export function MetricStrip({
  layout = 'grid',
  columns = 2,
  joinTop = false,
  children,
  ariaLabel,
}: MetricStripProps) {
  if (layout === 'flex') {
    return (
      <div className="pb-metric-strip pb-metric-strip--flex" aria-label={ariaLabel}>
        {children}
      </div>
    );
  }
  return (
    <div
      className="pb-metric-strip"
      aria-label={ariaLabel}
      style={{
        gridTemplateColumns: `repeat(${columns}, 1fr)`,
        ...(joinTop ? { borderTop: 0 } : {}),
      }}
    >
      {children}
    </div>
  );
}
