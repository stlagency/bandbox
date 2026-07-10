#!/usr/bin/env node
/**
 * Auth-fetch gate — regression guard for the July 2026 prod defect.
 *
 * Server auth (apps/web/src/lib/auth.ts getSession) reads ONLY the
 * `Authorization: Bearer <jwt>` header; the browser session lives in
 * localStorage and there are NO auth cookies. So a client component that calls
 * a gated /api route with raw `fetch()` is ALWAYS unauthenticated in
 * production — it only appears to work locally via the BANDBOX_DEV_USER_ID
 * dev seam (which is exactly how the bug shipped undetected: skip-trace,
 * save-lead, and CSV export were 401 for every signed-in prod user).
 *
 * This gate FAILS if any file under apps/web/src calls fetch() on a gated
 * route without going through apiFetch (apps/web/src/lib/api-client.ts, the
 * sole Bearer-attaching path). Server-side files are exempt (route handlers
 * never self-fetch these paths).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const WEB_SRC = join(ROOT, 'apps/web/src');

// Route prefixes that require a Bearer token (requireUser / requirePaid /
// requireAdmin). Public read routes (scan/parcel/comps/leads list/boundaries/
// geo) are intentionally NOT listed.
const GATED = [
  '/api/skiptrace',
  '/api/leads/save',
  '/api/leads/saved',
  '/api/leads/export',
  '/api/account',
  '/api/areas',
  '/api/alerts',
  '/api/admin',
  '/api/billing',
  '/api/attestation',
];

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx)$/.test(name)) yield p;
  }
}

const failures = [];
for (const file of walk(WEB_SRC)) {
  const src = readFileSync(file, 'utf8');
  // Only client modules can attach the browser session token.
  if (!/^\s*['"]use client['"]/.test(src)) continue;
  const lines = src.split('\n');
  lines.forEach((line, i) => {
    // A raw `fetch(` (not `apiFetch(`) whose literal names a gated route.
    if (!/(?<![a-zA-Z])fetch\s*\(/.test(line) || /apiFetch\s*\(/.test(line)) return;
    if (GATED.some((route) => line.includes(route))) {
      failures.push(`${relative(ROOT, file)}:${i + 1}: raw fetch() to a gated route — use apiFetch (lib/api-client)`);
    }
  });
}

if (failures.length > 0) {
  console.error('❌ auth-fetch gate FAILED — gated routes called without the Bearer-attaching apiFetch:\n');
  for (const f of failures) console.error(`  ${f}`);
  console.error(
    '\nRaw fetch() carries no Authorization header, so these calls are 401 for every',
  );
  console.error('signed-in production user (BANDBOX_DEV_USER_ID masks this in local dev).');
  process.exit(1);
}
console.log('✅ auth-fetch gate passed — every gated client call goes through apiFetch.');
