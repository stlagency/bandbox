'use client';

/**
 * MarketScan — the Market Scan surface, ported from
 * design/mockups/01-market-scan.html. Client component because the lens is
 * shared state across LensSwitcher → BlueprintMap → MapLegend (one active lens,
 * one meaning for color). The filter rail, time strip, and neighborhood detail
 * are the design reference; data is typed mock (scanByLens, pointBreezeDetail)
 * shaped like the frozen ScanResponse / DistressResult contracts.
 *
 * Red budget on this screen: the active-parcel red outline on the map is the
 * structural red; when the Distress lens is active the ramp itself IS the red
 * (the encoding). The rail's distress score block is the one red metric in the
 * rail; its "Save this neighborhood →" primary CTA is the second sanctioned red.
 */
import { useState } from 'react';
import type { LensMetric } from '@phillybricks/core/contracts';
import { TopBand } from '../components/TopBand';
import { FilterRail } from '../components/FilterRail';
import { LensSwitcher } from '../components/LensSwitcher';
import { BlueprintMap } from '../components/BlueprintMap';
import { MapLegend } from '../components/MapLegend';
import { TimeStrip } from '../components/TimeStrip';
import { DistressBlock } from '../components/DistressBlock';
import { MetricStrip, MetricCell } from '../components/MetricStrip';
import { TrendChart } from '../components/TrendChart';
import { CommunitySignal } from '../components/CommunitySignal';
import { Pill } from '../components/Pill';
import { Button } from '../components/Button';
import { pointBreezeDetail } from '../lib/mock/neighborhood';

export function MarketScan() {
  const [lens, setLens] = useState<LensMetric>('distress');
  const d = pointBreezeDetail;

  return (
    <div className="pb-app">
      <TopBand current="Market Scan" />

      <div className="pb-shell-scan">
        <FilterRail />

        <main className="pb-mapcol">
          <div className="pb-maphead">
            <div>
              <p className="pb-kicker">Know the block before you knock.</p>
              <h1>Market Scan</h1>
            </div>
            <div className="pb-crumbs">
              <span>City</span> <span>›</span> <b>Neighborhood</b> <span>›</span>{' '}
              <span>Tract</span> <span>›</span> <span>Parcel</span>
            </div>
          </div>

          <div className="pb-lensbar">
            <LensSwitcher active={lens} onChange={setLens} />
          </div>

          <div className="pb-map-outer">
            <BlueprintMap lens={lens} />
          </div>

          <div className="pb-timestrip-wrap">
            <TimeStrip minYear={2018} maxYear={2026} trackingSince="Mar 2018" />
          </div>

          <MapLegend lens={lens} />
        </main>

        {/* Right rail: neighborhood detail. On the scan, dotted terms + source
            stamps use native title tooltips (the mockup behavior); the teach-
            rail push mechanism is the deep-dive surface. DistressBlock's
            useRail() safely no-ops here. */}
          <aside className="pb-rightrail" aria-label="Neighborhood detail">
            <div className="pb-nh-head">
              <span className="pb-nh-eyebrow">{d.eyebrow}</span>
              <h2 className="pb-nh-name">{d.name}</h2>
              <span className="pb-nh-opa">{d.recordLine}</span>
            </div>

            <div className="pb-pillrow">
              {d.pills.map((p) => (
                <Pill key={p.label} kind={p.kind}>
                  {p.label}
                </Pill>
              ))}
            </div>

            <DistressBlock result={d.distress} rank={d.rank} />

            <MetricStrip layout="flex" ariaLabel="Neighborhood metrics">
              {d.metrics.map((m) => (
                <MetricCell
                  key={m.label}
                  label={m.label}
                  value={m.value}
                  valueTitle={m.title}
                  emphasis={m.emphasis === 'featured' ? 'featured' : 'none'}
                  sub={<span className="pb-msrc">{m.source_stamp}</span>}
                />
              ))}
            </MetricStrip>

            <TrendChart
              title={d.trend.title}
              bars={d.trend.bars}
              note={d.trend.note}
              ariaLabel={d.trend.ariaLabel}
            />

            <div className="pb-measureline">
              <span className="pb-lead">{d.measures.lead}</span>
              The{' '}
              <span className="pb-dotted" title={d.measures.dottedTitle}>
                {d.measures.dottedTerm}
              </span>{' '}
              {d.measures.body} <span className="pb-stamp">{d.measures.stamp}</span>
            </div>

            <CommunitySignal variant="rail">{d.communitySignal}</CommunitySignal>

            <div className="pb-cta-row">
              <Button variant="primary">Save this neighborhood →</Button>
              <Button variant="ghost" noShadow>
                Open {d.parcelCount.toLocaleString('en-US')} parcels
              </Button>
            </div>

            <p className="pb-freshline">{d.freshline}</p>
          </aside>
      </div>
    </div>
  );
}
