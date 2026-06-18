/**
 * Route "/" — Market Scan surface (PRD §7.1, the map-first front door).
 * Server component shell delegating to the client <MarketScan> (which owns the
 * shared active-lens state across the switcher, blueprint map, and legend).
 */
import { MarketScan } from './MarketScan';

export default function Page() {
  return <MarketScan />;
}
