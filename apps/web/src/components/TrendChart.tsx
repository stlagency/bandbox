/**
 * TrendChart — blocky bar chart, 2px ink borders, no gridlines (DESIGN.md
 * §Charts). One highlighted (most-recent) bar is red; the rest are Sky. Used in
 * the scan rail for the per-year trend (e.g. tax-delinquent parcels / yr). In
 * production the series comes from `geo_metric` (PRD §5.4); class-(b) metrics
 * carry the "tracking since …" caveat upstream.
 */
export interface TrendBar {
  year: string;
  /** Bar height as a percentage of the chart height (0–100). */
  pct: number;
  highlight?: boolean;
}

export interface TrendChartProps {
  title: string;
  bars: TrendBar[];
  note?: string;
  ariaLabel: string;
}

export function TrendChart({ title, bars, note, ariaLabel }: TrendChartProps) {
  return (
    <section className="pb-trendcard">
      <h3 className="pb-cardhdr">{title}</h3>
      <div className="pb-trend" role="img" aria-label={ariaLabel}>
        {bars.map((b) => (
          <div className="pb-col" key={b.year}>
            <div className={`pb-bar${b.highlight ? ' pb-bar--hi' : ''}`} style={{ height: `${b.pct}%` }} />
            <span className="pb-yr">{b.year}</span>
          </div>
        ))}
      </div>
      {note ? <p className="pb-trend-note">{note}</p> : null}
    </section>
  );
}
