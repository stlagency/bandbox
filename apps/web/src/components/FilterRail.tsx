'use client';

/**
 * FilterRail — the scan left structural rail (market-scan mockup): distress-
 * signal + property-type checkboxes with counts, a value-ceiling range with a
 * live mono readout, neighborhood + last-sale text inputs, and the add/reset
 * actions.
 *
 * Two modes, SAME markup:
 *  - UNCONTROLLED (no props): renders the static mockup exactly as before — the
 *    Market Scan surface uses <FilterRail /> with no props and must keep working.
 *  - CONTROLLED (value/onChange/facets/onReset): the distress checkboxes reflect
 *    honest `facets` counts and toggle `value.signals`; the value-ceiling range
 *    drives `value.maxValue`; the neighborhood + last-sale inputs drive
 *    `value.neighborhood` / `value.saleBefore`; Reset calls `onReset`. This is
 *    the Leads surface wiring (PRD §7.3 filter panel).
 */
import { useState } from 'react';
import { Button } from './Button';

/** Controlled filter state shared with the Leads surface. */
export interface FilterRailValue {
  /** distress_signal.score01 floor (0..1). */
  minScore: number;
  /** Active boolean signal flags (distress_signal columns). */
  signals: Set<string>;
  /** Neighborhood id or case-insensitive name, or '' for none. */
  neighborhood: string;
  /** market_value ceiling in DOLLARS, or null for no ceiling. */
  maxValue: number | null;
  /** Last-sale-before year (4-digit) as a string, or '' for none. */
  saleBefore: string;
}

interface CheckItem {
  label: string;
  count: string;
  checked?: boolean;
  /** distress_signal boolean column this checkbox toggles (controlled mode). */
  signal?: string;
}

// Static mockup data (uncontrolled mode). In controlled mode the distress counts
// are replaced from `facets` and the `signal` keys drive value.signals.
const DISTRESS: CheckItem[] = [
  { label: 'On sheriff list', count: '8,412', checked: true, signal: 'on_sheriff_list' },
  { label: 'Vacancy proxy', count: '5,109', checked: true, signal: 'vacancy_proxy' },
  { label: 'Sheriff flag (actionable)', count: '1,277', signal: 'actionable_sheriff_flag' },
  { label: 'Unsafe / imm. dangerous', count: '3,940', signal: 'unsafe_or_imm_dang' },
  { label: 'Out-of-state owner', count: '12,508', signal: 'out_of_state_owner' },
];

const TYPES: CheckItem[] = [
  { label: 'Rowhouse', count: '61%', checked: true },
  { label: 'Twin / duplex', count: '14%', checked: true },
  { label: 'Mixed-use', count: '9%' },
];

/** Compact mono count (e.g. 8412 → "8,412"); passes through non-numeric labels. */
function fmtCount(n: number): string {
  return n.toLocaleString('en-US');
}

function CheckGroup({
  title,
  items,
  value,
  facets,
  onToggle,
}: {
  title: string;
  items: CheckItem[];
  value?: FilterRailValue;
  facets?: Record<string, number>;
  onToggle?: (signal: string, checked: boolean) => void;
}) {
  const controlled = !!value;
  return (
    <div className="pb-fgroup">
      <span className="pb-flabel">{title}</span>
      {items.map((it) => {
        // In controlled mode, a distress row reflects value.signals + facet counts.
        const isSignal = controlled && it.signal != null;
        const checked = isSignal ? value!.signals.has(it.signal!) : it.checked;
        const count =
          isSignal && facets && it.signal! in facets ? fmtCount(facets[it.signal!]!) : it.count;
        return (
          <label className="pb-chkrow" key={it.label}>
            {isSignal ? (
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => onToggle?.(it.signal!, e.target.checked)}
              />
            ) : (
              <input type="checkbox" defaultChecked={it.checked} />
            )}
            <span className="pb-box" />
            {it.label}
            <span className="pb-fcount">{count}</span>
          </label>
        );
      })}
    </div>
  );
}

export interface FilterRailProps {
  /** Controlled filter state. Omit for the static (Market Scan) rendering. */
  value?: FilterRailValue;
  /** Called with the next filter value on any control change. */
  onChange?: (next: FilterRailValue) => void;
  /** Honest per-signal counts keyed by distress_signal column (controlled mode). */
  facets?: Record<string, number>;
  /** Called when Reset is pressed (controlled mode). */
  onReset?: () => void;
}

export function FilterRail({ value, onChange, facets, onReset }: FilterRailProps) {
  const controlled = !!value;

  // Uncontrolled: keep the local ceiling state so the mockup readout still moves.
  // Controlled: derive the slider position from value.maxValue (thousands).
  const [localCeiling, setLocalCeiling] = useState(350);
  const ceiling = controlled
    ? value!.maxValue != null
      ? Math.round(value!.maxValue / 1000)
      : 600
    : localCeiling;

  function emit(patch: Partial<FilterRailValue>) {
    if (!value || !onChange) return;
    onChange({ ...value, ...patch });
  }

  function toggleSignal(signal: string, checked: boolean) {
    if (!value) return;
    const next = new Set(value.signals);
    if (checked) next.add(signal);
    else next.delete(signal);
    emit({ signals: next });
  }

  function onCeiling(thousands: number) {
    if (controlled) {
      // 600k (the slider max) means "no ceiling" → null, otherwise dollars.
      emit({ maxValue: thousands >= 600 ? null : thousands * 1000 });
    } else {
      setLocalCeiling(thousands);
    }
  }

  // The distress floor is the primary leads control. The UI speaks 0–100 (the
  // score the user sees everywhere); the API floor is 0–1, converted here.
  const minScorePct = controlled ? Math.round(value!.minScore * 100) : 0;

  return (
    <aside className="pb-filterrail" aria-label="Filters">
      <h2 className="pb-railhead">Filters</h2>

      {controlled ? (
        <div className="pb-fgroup">
          <span className="pb-flabel">Distress Floor</span>
          <div className="pb-rangewrap">
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={minScorePct}
              aria-label="Minimum distress score, 0 to 100"
              onChange={(e) => emit({ minScore: Number(e.target.value) / 100 })}
            />
            <div className="pb-rangeread">{minScorePct === 0 ? 'Any' : `≥ ${minScorePct}`}</div>
          </div>
        </div>
      ) : null}

      <CheckGroup
        title="Distress Signals"
        items={DISTRESS}
        value={value}
        facets={facets}
        onToggle={toggleSignal}
      />
      <CheckGroup title="Property Type" items={TYPES} />

      <div className="pb-fgroup">
        <span className="pb-flabel">Est. Value Ceiling</span>
        <div className="pb-rangewrap">
          <input
            type="range"
            min={50}
            max={600}
            value={ceiling}
            aria-label="Estimated value ceiling, thousands"
            onChange={(e) => onCeiling(Number(e.target.value))}
          />
          <div className="pb-rangeread">{ceiling >= 600 ? 'No ceiling' : `≤ $${ceiling}k`}</div>
        </div>
      </div>

      <div className="pb-fgroup">
        <span className="pb-flabel">Neighborhood</span>
        <input
          className="pb-tag-input"
          type="text"
          placeholder="Passyunk, Fishtown…"
          aria-label="Filter by neighborhood"
          {...(controlled
            ? { value: value!.neighborhood, onChange: (e) => emit({ neighborhood: e.target.value }) }
            : {})}
        />
      </div>

      <div className="pb-fgroup">
        <span className="pb-flabel">Last Sale Before</span>
        <input
          className="pb-tag-input"
          type="text"
          inputMode="numeric"
          aria-label="Last sale before year"
          {...(controlled
            ? { value: value!.saleBefore, onChange: (e) => emit({ saleBefore: e.target.value }) }
            : { defaultValue: '2005' })}
        />
      </div>

      <div className="pb-cta-row">
        <Button variant="secondary">+ Add filter</Button>
        <Button variant="ghost" noShadow onClick={controlled ? onReset : undefined}>
          Reset
        </Button>
      </div>
    </aside>
  );
}
