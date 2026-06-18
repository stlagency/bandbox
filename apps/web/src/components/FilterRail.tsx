'use client';

/**
 * FilterRail — the scan left structural rail (market-scan mockup): distress-
 * signal + property-type checkboxes with counts, a value-ceiling range with a
 * live mono readout, neighborhood + last-sale text inputs, and the add/reset
 * actions. Filters are local UI state here; in production they drive the
 * `/api/scan` + `/api/leads` query params (PRD §7.1 filter panel).
 */
import { useState } from 'react';
import { Button } from './Button';

interface CheckItem {
  label: string;
  count: string;
  checked?: boolean;
}

const DISTRESS: CheckItem[] = [
  { label: 'Tax-delinquent', count: '8,412', checked: true },
  { label: 'Vacant', count: '5,109', checked: true },
  { label: 'Sheriff sale', count: '1,277' },
  { label: 'L&I violations', count: '3,940' },
];

const TYPES: CheckItem[] = [
  { label: 'Rowhouse', count: '61%', checked: true },
  { label: 'Twin / duplex', count: '14%', checked: true },
  { label: 'Mixed-use', count: '9%' },
];

function CheckGroup({ title, items }: { title: string; items: CheckItem[] }) {
  return (
    <div className="pb-fgroup">
      <span className="pb-flabel">{title}</span>
      {items.map((it) => (
        <label className="pb-chkrow" key={it.label}>
          <input type="checkbox" defaultChecked={it.checked} />
          <span className="pb-box" />
          {it.label}
          <span className="pb-fcount">{it.count}</span>
        </label>
      ))}
    </div>
  );
}

export function FilterRail() {
  const [ceiling, setCeiling] = useState(350);

  return (
    <aside className="pb-filterrail" aria-label="Filters">
      <h2 className="pb-railhead">Filters</h2>

      <CheckGroup title="Distress Signals" items={DISTRESS} />
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
            onChange={(e) => setCeiling(Number(e.target.value))}
          />
          <div className="pb-rangeread">≤ ${ceiling}k</div>
        </div>
      </div>

      <div className="pb-fgroup">
        <span className="pb-flabel">Neighborhood</span>
        <input
          className="pb-tag-input"
          type="text"
          placeholder="Passyunk, Fishtown…"
          aria-label="Filter by neighborhood"
        />
      </div>

      <div className="pb-fgroup">
        <span className="pb-flabel">Last Sale Before</span>
        <input
          className="pb-tag-input"
          type="text"
          defaultValue="2005"
          aria-label="Last sale before year"
        />
      </div>

      <div className="pb-cta-row">
        <Button variant="secondary">+ Add filter</Button>
        <Button variant="ghost" noShadow>
          Reset
        </Button>
      </div>
    </aside>
  );
}
