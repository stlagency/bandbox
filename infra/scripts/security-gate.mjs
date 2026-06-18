#!/usr/bin/env node
/**
 * RLS / secrets security gate (PRD §3.6, §8) — ONE OF THE FOUR ADVERSARIAL GATES.
 *
 * Static statement-level pass over packages/db/migrations/*.sql. Hardened after an
 * adversarial review found that naive single-role regexes let `authenticated` keep
 * writes / SELECT while only `anon` was revoked. This gate now parses GRANT/REVOKE
 * statements and FAILS if:
 *   1. any `public.<table>` lacks `ENABLE ROW LEVEL SECURITY`;
 *   2. any `public.<table>` does not REVOKE writes (insert/update/delete or ALL)
 *      from BOTH anon AND authenticated;
 *   3. any `public.<table>` GRANTs a write (insert/update/delete/ALL) to anon or
 *      authenticated (write-escalation), or fails to GRANT SELECT to anon;
 *   4. `app.skiptrace_key` does not REVOKE SELECT from BOTH anon AND authenticated,
 *      or GRANTs SELECT (table- or column-level) to either (encrypted_key must only
 *      be readable inside the SECURITY DEFINER proxy);
 *   5. `app.subscription` GRANTs any write to anon/authenticated (service_role only);
 *   6. any `ops.*` relation is GRANTed to anon/authenticated.
 *
 * The LIVE gate (infra/scripts/security-gate-live.mjs — pg_catalog introspection
 * after running migrations against ephemeral PostGIS in CI) is the belt-and-braces
 * enforcement; this static pass guards the source of truth and runs without a DB.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const MIG_DIR = join(ROOT, 'packages/db/migrations');

if (!existsSync(MIG_DIR)) {
  console.log('ℹ️  No migrations directory yet — security gate has nothing to guard. (M0 skeleton.)');
  process.exit(0);
}

const sqlFiles = readdirSync(MIG_DIR).filter((f) => f.endsWith('.sql')).sort();
const raw = sqlFiles.map((f) => readFileSync(join(MIG_DIR, f), 'utf8')).join('\n');
// strip line + block comments so a documentation comment never satisfies a check
const noComments = raw.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
const sql = noComments.toLowerCase();
const norm = sql.replace(/\s+/g, ' ');

if (!/create\s+table\s+public\./.test(norm)) {
  console.log('ℹ️  No public.* tables defined yet — security gate vacuously passes. (M0 skeleton.)');
  process.exit(0);
}

const EXPOSED = ['anon', 'authenticated'];
const WRITE = ['insert', 'update', 'delete'];

/** Parse a GRANT/REVOKE statement → {action, privs:Set, columnScoped, relation, roles:Set} | null */
function parseAccess(stmt) {
  const m = stmt.match(/^(grant|revoke)\s+(.+?)\s+on\s+(?:table\s+)?([a-z0-9_."]+)\s+(to|from)\s+(.+)$/);
  if (!m) return null;
  const [, action, privPart, relRaw, , rolePart] = m;
  const relation = relRaw.replace(/"/g, '');
  const columnScoped = /\(/.test(privPart);
  const privs = new Set(privPart.replace(/\([^)]*\)/g, ' ').split(/[,\s]+/).filter(Boolean));
  const roles = new Set(rolePart.replace(/\([^)]*\)/g, ' ').split(/[,\s]+/).filter(Boolean));
  return { action, privs, columnScoped, relation, roles };
}

const statements = norm.split(';').map((s) => s.trim()).filter(Boolean);
const access = statements.map(parseAccess).filter(Boolean);
const hasWrite = (privs) => privs.has('all') || WRITE.some((w) => privs.has(w));
const hasSelect = (privs) => privs.has('all') || privs.has('select');

const tableNames = new Set();
for (const m of norm.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-z0-9_]+)/g)) {
  tableNames.add(m[1]);
}

const failures = [];

for (const t of tableNames) {
  const fq = `public.${t}`;
  if (!new RegExp(`alter\\s+table\\s+${fq}\\s+enable\\s+row\\s+level\\s+security`).test(norm)) {
    failures.push(`${fq}: missing ENABLE ROW LEVEL SECURITY`);
  }
  // (2) writes revoked from BOTH exposed roles
  const writeRevoked = new Set();
  for (const a of access) {
    if (a.action === 'revoke' && a.relation === fq && hasWrite(a.privs)) {
      for (const r of a.roles) writeRevoked.add(r);
    }
  }
  for (const r of EXPOSED) {
    if (!writeRevoked.has(r)) failures.push(`${fq}: writes not revoked from "${r}" (need REVOKE INSERT,UPDATE,DELETE — or ALL — from anon AND authenticated)`);
  }
  // (3a) no write GRANT to an exposed role
  for (const a of access) {
    if (a.action === 'grant' && a.relation === fq && hasWrite(a.privs)) {
      const esc = EXPOSED.filter((r) => a.roles.has(r));
      if (esc.length) failures.push(`${fq}: WRITE GRANT to ${esc.join(', ')} (write-escalation) — anon/authenticated must be read-only`);
    }
  }
  // (3b) SELECT granted to anon (exposed-readable)
  const selectToAnon = access.some((a) => a.action === 'grant' && a.relation === fq && hasSelect(a.privs) && a.roles.has('anon'));
  if (!selectToAnon) failures.push(`${fq}: missing GRANT SELECT TO anon (exposed-readable table)`);
}

// (4) app.skiptrace_key — encrypted_key never selectable outside the SECURITY DEFINER proxy
if (/create\s+table\s+(?:if\s+not\s+exists\s+)?app\.skiptrace_key/.test(norm)) {
  const fq = 'app.skiptrace_key';
  const selectRevoked = new Set();
  for (const a of access) {
    if (a.action === 'revoke' && a.relation === fq && hasSelect(a.privs)) {
      for (const r of a.roles) selectRevoked.add(r);
    }
  }
  for (const r of EXPOSED) {
    if (!selectRevoked.has(r)) failures.push(`${fq}: SELECT not revoked from "${r}" (encrypted_key must not be selectable by anon/authenticated)`);
  }
  for (const a of access) {
    if (a.action === 'grant' && a.relation === fq) {
      const esc = EXPOSED.filter((r) => a.roles.has(r));
      if (esc.length && (hasSelect(a.privs) || a.columnScoped)) {
        failures.push(`${fq}: SELECT/column GRANT to ${esc.join(', ')} — encrypted_key would be readable outside the proxy`);
      }
    }
  }
}

// (5) app.subscription — written only by the service_role webhook
if (/create\s+table\s+(?:if\s+not\s+exists\s+)?app\.subscription/.test(norm)) {
  for (const a of access) {
    if (a.action === 'grant' && a.relation === 'app.subscription' && hasWrite(a.privs)) {
      const esc = EXPOSED.filter((r) => a.roles.has(r));
      if (esc.length) failures.push(`app.subscription: WRITE GRANT to ${esc.join(', ')} — only the service_role webhook may write subscriptions`);
    }
  }
}

// (6) ops.* never granted to an exposed role
for (const a of access) {
  if (a.action === 'grant' && a.relation.startsWith('ops.')) {
    const esc = EXPOSED.filter((r) => a.roles.has(r));
    if (esc.length) failures.push(`${a.relation}: GRANT to ${esc.join(', ')} — ops holds raw error text + cursors, never expose it`);
  }
}

if (failures.length > 0) {
  console.error('❌ Security gate FAILED (static SQL pass):');
  for (const f of failures) console.error(`  • ${f}`);
  console.error('\nFix the migrations so every exposed relation is RLS-enabled, write-revoked from both anon+authenticated, and correctly granted.');
  process.exit(1);
}

console.log(`✅ Security gate passed (static) — ${tableNames.size} public table(s) RLS-enabled + writes revoked from anon+authenticated + SELECT-granted; skiptrace_key SELECT-locked (table+column), subscription write-locked, ops sealed.`);
