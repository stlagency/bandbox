# Bandbox — decommissioned 2026-09-28

**Bandbox is cancelled.** It will be rebuilt from scratch as a module of **SpeedJawn**
(`~/CLAUDEMAXING/cc_SpeedJawn`, www.speedjawn.com). This repo is kept read-only as the reference
implementation. The paste-ready rebuild prompt is at the bottom of this file and also in the
archive folder as `REBUILD_PROMPT.md`.

## What was shut down (2026-09-28)

| Item | Recurring cost before | State now | Undo |
|---|---|---|---|
| GitHub Actions `Nightly ingestion` + `Weekly resync` | free (public repo); DB writes + email sends | **disabled** (`disabled_manually`). `CI` left on. | `gh workflow enable "Nightly ingestion"` |
| Vercel project `bandbox` (`prj_DiIbXmTug1Qa6DVQm68VRP5kyre1`) | usage inside the shared team Pro plan | **paused**: www.bandbox.pro serves 503. **Git auto-deploy disconnected**, so pushes to `main` no longer deploy. | `POST /v1/projects/{id}/unpause`; `vercel git connect` |
| Stripe (STL Agency LLC) | $0: **no subscriptions ever existed** | product `prod_UjlBUIOMalmri0` + price `price_1TkHfU…` **archived**; webhook `we_1TkHfU…` **disabled** | Stripe dashboard → unarchive / enable |
| ZeptoMail digests | prepaid credits | no more sends (nightly off) | — |
| Supabase project `phillybricks` (`ctcvrdsrylauqpuxbauz`) | **~$10/mo Micro compute + ~$0.50/mo disk over 8 GB (12 GB provisioned)** | **still running**, pending the off-machine backup copy (below) | — |

**Unchanged, because other projects share them:** the Supabase **Pro plan ($25/mo)** covers 10 other
projects in org "STL Agentic", speedjawn among them. The Vercel **Pro plan ($20/mo)** covers 20+
other projects on team `stlagencys-projects`. Killing Bandbox cannot remove either fee.

## Database backup (DONE, verified)

A full logical dump lives at **`~/Bandbox-Archive/2026-09-28/`** (580 MB total):
- `bandbox-db-2026-09-28.dump` is a `pg_dump -Fc` of `public` + `app` + `ops` (PG 17).
- **Verified by a full test restore** into a clean local PG17 + PostGIS 3.6. **Row counts in all 31
  tables/matviews match production exactly** (`source-row-counts.tsv` is byte-identical to
  `restored-row-counts.tsv`). Geometry, matviews and 92 indexes all came through.
- Also in the folder: DDL-only schema, the four PMTiles, a `git bundle --all` of this repo, restore
  instructions (`README.md`), `restore-prep.sql`, and `SHA256SUMS`.
- `app.*` and `auth.users` were **empty** at shutdown (0 users, 0 subscriptions), so the archive holds no user PII.
- The one irreplaceable table is `public.parcel_change_log` (2,939,670 rows): nightly history accrued
  since 2026-06-18 that the city does not publish.

## Remaining plan

1. **Get the archive off this Mac** (the only copy right now is on the internal SSD). Do both:
   - **External drive:** plug it in, then
     `cp -R ~/Bandbox-Archive /Volumes/<DRIVE>/ && cd /Volumes/<DRIVE>/Bandbox-Archive/2026-09-28 && shasum -a 256 -c SHA256SUMS`
   - **Cloud:** iCloud Drive is already on this Mac:
     `cp -R ~/Bandbox-Archive ~/Library/Mobile\ Documents/com~apple~CloudDocs/` (580 MB), or
     upload the folder to Google Drive or Dropbox. Run the `shasum -c` check on any copy you later download.
2. **Delete the Supabase project**, only after step 1 is verified. This removes the ~$10.50/mo:
   `curl -X DELETE -H "Authorization: Bearer $(cat <memory>/supabase-access-token.secret)" https://api.supabase.com/v1/projects/ctcvrdsrylauqpuxbauz`
   The deletion is permanent, and the project's own 7-day physical backups go with it.
3. **Domain `bandbox.pro`** is registered at **Porkbun** and renews **2027-06-19**. Either turn off
   auto-renew in Porkbun, or keep it and point it at the new SpeedJawn module (a Cloudflare redirect
   rule, free). DNS is on Cloudflare (zone `309b9c34e88229d6fe9f0aa586d93f44`).
4. **Zoho Mail:** `bandbox.pro` MX records point at Zoho. If that mailbox is on a paid Zoho plan,
   cancel it. The ZeptoMail sending domain can stay; it bills per credit.
5. Optional cleanup, no cost impact: delete the Vercel project; archive the GitHub repo
   (`gh repo archive stlagency/bandbox`); remove the Cloudflare DNS records.

## Rebuild prompt

Paste-ready: **[`docs/REBUILD_PROMPT.md`](REBUILD_PROMPT.md)** (the archive folder has the same file).
Open a new Claude Code session in `~/CLAUDEMAXING/cc_SpeedJawn` and paste it.
