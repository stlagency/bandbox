'use client';

/**
 * TimeStrip — bordered time slider + "tracking since {date}" note (DESIGN.md
 * §Map; PRD §7.1). The range comes from the scan response's per-lens
 * period_min/period_max; class-(b) (forward-accruing) lenses get the
 * "tracking since …" framing. Controlled value with a mono readout.
 */
import { useState } from 'react';

export interface TimeStripProps {
  minYear: number;
  maxYear: number;
  /** Initial year (defaults to maxYear). */
  initialYear?: number;
  /** "tracking since …" note (shown for forward-accruing lenses). */
  trackingSince?: string;
}

export function TimeStrip({ minYear, maxYear, initialYear, trackingSince }: TimeStripProps) {
  const [year, setYear] = useState(initialYear ?? maxYear);
  const quarter = year === maxYear ? ' Q2' : '';

  return (
    <div className="pb-timestrip">
      <span className="pb-tlabel">Time</span>
      <input
        type="range"
        min={minYear}
        max={maxYear}
        value={year}
        aria-label="Time period, year"
        onChange={(e) => setYear(Number(e.target.value))}
      />
      <span className="pb-tval">
        {year}
        {quarter}
      </span>
      {trackingSince ? <span className="pb-tnote">tracking since {trackingSince}</span> : null}
    </div>
  );
}
