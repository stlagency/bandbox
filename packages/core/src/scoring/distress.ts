/**
 * Distress composite scoring (PRD §5.3). Pure + fully decomposable: every
 * component carries its raw value, the documented [0,1] normalization, its
 * weight, and `contribution = weight × normalized`. The composite
 * `score01 = Σ contribution ∈ [0,1]`; `score100 = round(score01 × 100)`.
 *
 * "One opinionated lens." Nothing here is a black box: the returned
 * `DistressComponent[]` is exactly what the parcel page renders and the API
 * returns (§6), and `weightsVersion` ties the result to the config that
 * produced it.
 */
import type {
  DistressComponent,
  DistressComponentKey,
  DistressResult,
} from '../contracts/index.js';
import {
  DISTRESS_CONFIG,
  DISTRESS_COMPONENT_KEYS,
  type DistressConfig,
  type NormalizeDescriptor,
} from './config.js';

/**
 * Raw per-component signal for a parcel. Each value is the UNTRANSFORMED public
 * record figure (dollars, counts, booleans). `null`/absent ⇒ the signal is
 * unobserved → normalized 0 (it neither raises nor is invented).
 */
export interface DistressSignalInput {
  parcel_pk: string;
  /** Untransformed raw signals; null/absent ⇒ normalized 0. */
  signals: Partial<Record<DistressComponentKey, number | boolean | null>>;
  /** Optional per-component provenance for the decomposition UI. */
  sources?: Partial<Record<DistressComponentKey, { url?: string; stamp?: string }>>;
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * Apply a component's documented normalization to its raw value, returning a
 * value in [0,1]. Absent (null/undefined) or non-finite signals → 0.
 */
function normalizeRaw(
  raw: number | boolean | null | undefined,
  desc: NormalizeDescriptor,
): number {
  if (raw === null || raw === undefined) return 0; // absent signal → 0
  if (desc.kind === 'boolean') {
    if (typeof raw === 'boolean') return raw ? 1 : 0;
    // tolerate numeric truthiness (e.g. 1/0 from SQL)
    return raw !== 0 ? 1 : 0;
  }
  // linear_cap
  const n = typeof raw === 'boolean' ? (raw ? 1 : 0) : raw;
  if (!Number.isFinite(n)) return 0;
  if (desc.cap <= 0) return 0;
  return clamp01(n / desc.cap);
}

/** Human-readable display of the raw value, with units, for the UI. */
function rawDisplay(
  raw: number | boolean | null | undefined,
  desc: NormalizeDescriptor,
): string {
  if (raw === null || raw === undefined) return 'none';
  if (desc.kind === 'boolean') {
    return (typeof raw === 'boolean' ? raw : raw !== 0) ? 'yes' : 'no';
  }
  const n = typeof raw === 'boolean' ? (raw ? 1 : 0) : raw;
  if (desc.unit === 'dollars') {
    return `$${Math.round(n).toLocaleString('en-US')} owed`;
  }
  if (desc.unit === 'count') {
    return `${n} open`;
  }
  // density / fraction
  return `${n}`;
}

/**
 * Score a parcel's distress. Each component is normalized to [0,1] via its
 * documented transform, weighted, and summed. Components are emitted in the
 * canonical config order, each matching the frozen `DistressComponent` contract.
 */
export function scoreDistress(
  input: DistressSignalInput,
  config: DistressConfig = DISTRESS_CONFIG,
): DistressResult {
  const components: DistressComponent[] = [];
  let score01 = 0;

  for (const key of DISTRESS_COMPONENT_KEYS) {
    const cfg = config.components[key];
    const raw = input.signals[key] ?? null;
    const normalized = clamp01(normalizeRaw(raw, cfg.normalize));
    const contribution = cfg.weight * normalized;
    score01 += contribution;

    const prov = input.sources?.[key];
    components.push({
      component: key,
      label: cfg.label,
      raw_value: raw,
      raw_display: rawDisplay(raw, cfg.normalize),
      normalized,
      weight: cfg.weight,
      contribution,
      source_url: prov?.url ?? '',
      source_stamp: prov?.stamp ?? '',
    });
  }

  // Σ contribution is mathematically ≤ Σ weight = 1, but guard float drift.
  score01 = clamp01(score01);

  return {
    parcel_pk: input.parcel_pk,
    score01,
    score100: Math.round(score01 * 100),
    components,
    weightsVersion: config.version,
  };
}
