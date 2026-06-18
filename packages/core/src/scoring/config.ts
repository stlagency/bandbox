/**
 * Versioned distress-scoring config (PRD §5.3, §11). The weights AND the
 * normalization transforms live here as a single versioned artifact so a result
 * can be tied back to the exact config that produced it (`weightsVersion`).
 * Bump `DISTRESS_CONFIG.version` (and `CORE_VERSION`) whenever a weight or a
 * normalize descriptor changes.
 *
 * Σ weight over all 9 components MUST equal 1 (asserted in tests to 1e-9). Each
 * component declares a DOCUMENTED [0,1] normalization transform:
 *   - boolean  → maps {false,true} to {0,1}.
 *   - linear_cap → count/dollar value clamped to [0, cap] then divided by cap
 *                  (piecewise: 0 at/below 0, 1 at/above cap, linear between).
 *   - absent signal (null) → normalized 0 (handled in distress.ts).
 */
import type { DistressComponentKey } from '../contracts/index.js';

/** A documented normalization descriptor for one component. */
export type NormalizeDescriptor =
  | { kind: 'boolean' }
  | {
      /**
       * Piecewise-linear with a stated cap: normalized = clamp(raw,0,cap)/cap.
       * `unit` documents what `raw` measures (count | dollars | density).
       */
      kind: 'linear_cap';
      cap: number;
      unit: 'count' | 'dollars' | 'density';
    };

export interface DistressComponentConfig {
  /** Human label rendered on the parcel page + leads table. */
  label: string;
  /** Versioned weight; Σ over all components = 1. */
  weight: number;
  /** Documented [0,1] transform of the raw signal. */
  normalize: NormalizeDescriptor;
}

export interface DistressConfig {
  version: string;
  components: Record<DistressComponentKey, DistressComponentConfig>;
}

/**
 * v1 default weights (PRD §5.3 / §11 documented defaults; tunable). They sum to
 * exactly 1.00. Caps below are documented defaults chosen against typical Philly
 * distributions; M3 may retune them (this is versioned config).
 */
export const DISTRESS_CONFIG: DistressConfig = {
  version: 'distress-2026-06-18.v1',
  components: {
    // Years/dollars of tax owed. Cap at $25k owed → treat as fully delinquent.
    tax_delinquent: {
      label: 'Tax-delinquent',
      weight: 0.2,
      normalize: { kind: 'linear_cap', cap: 25_000, unit: 'dollars' },
    },
    // Boolean: the delinquency record's actionable sheriff-sale flag.
    actionable_sheriff_flag: {
      label: 'Actionable sheriff flag',
      weight: 0.12,
      normalize: { kind: 'boolean' },
    },
    // Count of open violations (hazard-weighted upstream). Cap at 5 → saturated.
    open_violations: {
      label: 'Open violations',
      weight: 0.14,
      normalize: { kind: 'linear_cap', cap: 5, unit: 'count' },
    },
    // Boolean: present on unsafe / imminently-dangerous inventory.
    unsafe_or_imm_dang: {
      label: 'Unsafe / imminently dangerous',
      weight: 0.12,
      normalize: { kind: 'boolean' },
    },
    // Count of recent complaints (density). Cap at 4 → saturated.
    recent_complaints: {
      label: 'Recent complaints',
      weight: 0.08,
      normalize: { kind: 'linear_cap', cap: 4, unit: 'density' },
    },
    // Boolean: appears on the forward sheriff-sale listing.
    on_sheriff_list: {
      label: 'On sheriff list',
      weight: 0.1,
      normalize: { kind: 'boolean' },
    },
    // Boolean: owner mailing address is out of state.
    out_of_state_owner: {
      label: 'Out-of-state owner',
      weight: 0.06,
      normalize: { kind: 'boolean' },
    },
    // Boolean: vacancy proxy (no recent permits/activity + indicators upstream).
    vacancy_proxy: {
      label: 'Vacancy proxy',
      weight: 0.12,
      normalize: { kind: 'boolean' },
    },
    // Fraction below comps-derived expected value. Cap at 0.40 (40% under) → 1.
    below_market_last_sale: {
      label: 'Below-market last sale',
      weight: 0.06,
      normalize: { kind: 'linear_cap', cap: 0.4, unit: 'density' },
    },
  },
};

/** All nine component keys in their canonical (config) order. */
export const DISTRESS_COMPONENT_KEYS = Object.keys(
  DISTRESS_CONFIG.components,
) as DistressComponentKey[];
