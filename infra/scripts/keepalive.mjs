#!/usr/bin/env node
/**
 * Repo-mutating keep-alive (PRD §4.1, §10).
 *
 * GitHub auto-disables a `schedule:` workflow after 60 days of repository
 * inactivity. The cron *trigger firing* does NOT count as activity — only a
 * commit/comment to the repo resets the clock. So the nightly workflow commits
 * the file this script updates on every run; the diff is what keeps the cron alive.
 *
 * Determinism: the timestamp is READ FROM AN ENV VAR the workflow sets (KEEPALIVE_TS,
 * with KEEPALIVE_RUN_ID / KEEPALIVE_SHA as optional provenance), never Date.now().
 * That makes the write reproducible from its inputs and keeps the test suite
 * deterministic — re-running with the same env yields the same file content.
 *
 * Usage (the workflow sets these):
 *   KEEPALIVE_TS="2026-06-18T09:17:00Z" \
 *   KEEPALIVE_RUN_ID="$GITHUB_RUN_ID" KEEPALIVE_SHA="$GITHUB_SHA" \
 *   node infra/scripts/keepalive.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const HEARTBEAT_FILE = join(HERE, '..', 'heartbeat', 'last-run.txt');

const ts = process.env.KEEPALIVE_TS;
if (!ts || !ts.trim()) {
  console.error(
    '❌ keepalive: KEEPALIVE_TS is required (an ISO-8601 timestamp set by the workflow). ' +
      'This script never calls Date.now() — determinism is intentional.',
  );
  process.exit(2);
}

const runId = process.env.KEEPALIVE_RUN_ID?.trim() || 'local';
const sha = process.env.KEEPALIVE_SHA?.trim() || 'unknown';
const workflow = process.env.KEEPALIVE_WORKFLOW?.trim() || 'nightly';

// A short, stable, human-readable record. The trailing newline satisfies
// .editorconfig (insert_final_newline) and keeps diffs to a single line.
const contents =
  `last-run=${ts.trim()}\n` +
  `workflow=${workflow}\n` +
  `run-id=${runId}\n` +
  `sha=${sha}\n`;

mkdirSync(dirname(HEARTBEAT_FILE), { recursive: true });
writeFileSync(HEARTBEAT_FILE, contents, 'utf8');

console.log(`✅ keepalive: wrote heartbeat (${ts.trim()}, run ${runId}) → infra/heartbeat/last-run.txt`);
