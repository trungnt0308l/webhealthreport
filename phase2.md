# Phase 2 — Scheduled Scans + Email Delivery

## Architecture

```
[Hourly cron]    Scan Launcher  → bootstraps scan directly in D1
                               → atomically claims pending_scan_id
                               → enqueues { scanId, siteId }

[Queue consumer] Scan Runner   → calls processBatch() in a loop (12 min budget)
                               → msg.retry(60s) if not done — resumes from D1 state
                               → sends email on completion
                               → clears pending_scan_id atomically with next_scan_at advance

[DLQ consumer]   Cleanup       → clears stuck pending_scan_id when max retries exhausted
```

No polling cron. Queue messages auto-retry with D1 state preserved — a scan longer than 15 min simply resumes cleanly in the next invocation.

---

## Part 0 — Prerequisite refactors

### A. `functions/_lib/scan-engine.js` (extract from `status.js`)

```js
export async function processBatch(env, scanId)
// Returns: { status: 'running'|'complete'|'failed', recentChecks: [] }
```

- Contains all batch-claim → fetch → write logic from `status.js` lines 59–245
- Resets stale `processing` items (> 10 min old) to `pending` at start of each call
- `status.js` becomes a thin wrapper: load scan → call `processBatch` → return progress response

### B. `functions/_lib/scan-bootstrap.js` (extract from `scans/index.js`)

```js
export async function bootstrapScan(env, scanId, url, baseDomain)
// Inserts scan record, fetches homepage, seeds crawl_queue
// Throws on failure
```

Used by both `scans/index.js` (HTTP handler) and the scheduler (direct D1, no HTTP call).

### C. Schema: `claimed_at` on `crawl_queue`

```sql
ALTER TABLE crawl_queue ADD COLUMN claimed_at INTEGER;
```

Claim query sets `claimed_at = unixepoch()`. Start of each `processBatch` resets items where `status = 'processing' AND claimed_at < unixepoch() - 600` back to `pending`.

---

## Part 1 — Database Schema (`schema.sql`)

```sql
CREATE TABLE IF NOT EXISTS monitored_sites (
  id              TEXT PRIMARY KEY,
  url             TEXT NOT NULL,
  base_domain     TEXT NOT NULL,
  emails          TEXT NOT NULL,        -- JSON array ["a@b.com", ...]
  last_scan_id    TEXT REFERENCES scans(id),
  pending_scan_id TEXT REFERENCES scans(id),  -- mutex: non-null while scan is running
  next_scan_at    INTEGER NOT NULL,
  created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_monitored_sites_next
  ON monitored_sites (next_scan_at) WHERE pending_scan_id IS NULL;
```

`pending_scan_id` acts as a mutex — launcher only fires for sites where it is NULL. Cleared atomically with `next_scan_at` advancement when the consumer finishes.

---

## Part 2 — New Pages API Endpoints

### `functions/api/monitored-sites/index.js`

**POST** `/api/monitored-sites?key=<MONITOR_SECRET>`
- Body: `{ url, emails: ["a@b.com", ...] }`
- Reuse `normalizeUrl` + `getBaseDomain` from `functions/_lib/crawl.js`
- Random spread: `next_scan_at = now + Math.floor(Math.random() * 604800)`
- Key validated server-side against `env.MONITOR_SECRET`
- Returns `{ id }`

**GET** `/api/monitored-sites?key=<MONITOR_SECRET>` — list all sites

### `functions/api/monitored-sites/[id].js`

**DELETE** `/api/monitored-sites/:id?key=<MONITOR_SECRET>` — remove site

Both return 403 on missing/wrong key.

---

## Part 3 — Scheduler Worker (`scheduler/`)

### `scheduler/wrangler.toml`

```toml
name = "webhealthreport-scheduler"
compatibility_date = "2024-09-23"
main = "index.js"

[[triggers.crons]]
crons = ["0 * * * *"]    # hourly launcher

[[d1_databases]]
binding = "DB"
database_name = "webhealthreport"
database_id = "c379e50c-5790-46da-88fa-83c5b82ebeb0"

[[queues.producers]]
binding = "SCAN_QUEUE"
queue   = "webhealthreport-scans"

[[queues.consumers]]
queue              = "webhealthreport-scans"
max_batch_size     = 1      # one scan per invocation
max_batch_timeout  = 30
max_retries        = 20     # 20 × ~12 min ≈ 4 hrs max per scan
dead_letter_queue  = "webhealthreport-scans-dlq"
max_concurrency    = 5      # up to 5 scans in parallel

[[queues.consumers]]
queue          = "webhealthreport-scans-dlq"
max_batch_size = 10

[vars]
FROM_EMAIL = "reports@<YOUR_VERIFIED_DOMAIN>"   # ← fill in before deploying

[secrets]
# RESEND_API_KEY — wrangler secret put RESEND_API_KEY
# MONITOR_SECRET — wrangler secret put MONITOR_SECRET
```

### `scheduler/index.js` — structure

```js
import { bootstrapScan }   from '../functions/_lib/scan-bootstrap.js';
import { processBatch }    from '../functions/_lib/scan-engine.js';
import { sendReportEmail } from './email.js';

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(launchDueScans(env));
  },
  async queue(batch, env) {
    for (const msg of batch.messages) {
      if (msg.body.isDlq) {
        // DLQ cleanup — release stuck pending_scan_id
        await env.DB.prepare(
          `UPDATE monitored_sites SET pending_scan_id = NULL WHERE id = ?`
        ).bind(msg.body.siteId).run();
        msg.ack();
      } else {
        await runScan(env, msg);
      }
    }
  },
};
```

### `launchDueScans(env)`

```js
async function launchDueScans(env) {
  const now = Math.floor(Date.now() / 1000);
  const due = await env.DB.prepare(
    `SELECT id, url, base_domain FROM monitored_sites
     WHERE next_scan_at <= ? AND pending_scan_id IS NULL LIMIT 20`
  ).bind(now).all();

  for (const site of due.results) {
    const scanId = crypto.randomUUID().replace(/-/g,'').slice(0,16);

    // Atomic claim — skip if another invocation claimed first
    const claim = await env.DB.prepare(
      `UPDATE monitored_sites SET pending_scan_id = ?
       WHERE id = ? AND pending_scan_id IS NULL`
    ).bind(scanId, site.id).run();
    if (claim.meta.changes === 0) continue;

    try {
      await bootstrapScan(env, scanId, site.url, site.base_domain);
    } catch (err) {
      console.error(`Bootstrap failed for ${site.url}:`, err);
      await env.DB.prepare(
        `UPDATE monitored_sites SET pending_scan_id = NULL WHERE id = ?`
      ).bind(site.id).run();
      continue;
    }

    await env.SCAN_QUEUE.send({ scanId, siteId: site.id });
  }
}
```

### `runScan(env, msg)`

```js
async function runScan(env, msg) {
  const { scanId, siteId } = msg.body;
  const deadline = Date.now() + 12 * 60 * 1000; // 12 min budget

  try {
    while (Date.now() < deadline) {
      const { status } = await processBatch(env, scanId);

      if (status === 'complete') {
        await onScanComplete(env, msg, scanId, siteId);
        return;
      }
      if (status === 'failed') {
        await env.DB.prepare(
          `UPDATE monitored_sites SET pending_scan_id = NULL WHERE id = ?`
        ).bind(siteId).run();
        msg.ack();
        return;
      }
      // 'running' — continue loop
    }
    // Time's up — resume in next invocation (D1 state persists)
    msg.retry({ delaySeconds: 60 });

  } catch (err) {
    console.error(`Scan error [${scanId}]:`, err);
    if (msg.attempts >= 20) {
      await env.DB.prepare(
        `UPDATE monitored_sites SET pending_scan_id = NULL WHERE id = ?`
      ).bind(siteId).run();
      msg.ack();
    } else {
      msg.retry({ delaySeconds: 60 });
    }
  }
}
```

### `onScanComplete(env, msg, scanId, siteId)`

```js
async function onScanComplete(env, msg, scanId, siteId) {
  // Get or generate report
  let row = await env.DB.prepare(
    `SELECT rendered_summary_json FROM reports WHERE scan_id = ? AND report_type = 'browser'`
  ).bind(scanId).first();
  if (!row) {
    const { generateReport } = await import('../functions/_lib/report.js');
    await generateReport(env, scanId, null, null, null);
    row = await env.DB.prepare(
      `SELECT rendered_summary_json FROM reports WHERE scan_id = ? AND report_type = 'browser'`
    ).bind(scanId).first();
  }

  const report = JSON.parse(row.rendered_summary_json);
  const site   = await env.DB.prepare(
    `SELECT * FROM monitored_sites WHERE id = ?`
  ).bind(siteId).first();

  // Send email — failure is logged but never blocks schedule advancement
  try {
    await sendReportEmail(env, site, report);
  } catch (err) {
    console.error(`Email failed for site ${siteId}:`, err);
  }

  // Advance schedule and release mutex (atomically)
  await env.DB.prepare(
    `UPDATE monitored_sites
     SET pending_scan_id = NULL, last_scan_id = ?, next_scan_at = next_scan_at + 604800
     WHERE id = ?`
  ).bind(scanId, siteId).run();

  msg.ack();
}
```

---

## Part 4 — Email (`scheduler/email.js`)

**Service**: Resend API. Throws on non-2xx so caller can log.

```js
export async function sendReportEmail(env, site, report) {
  const emails = JSON.parse(site.emails);
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.FROM_EMAIL,
      to: emails,
      subject: `[${report.grade}] ${report.baseDomain} — weekly health report`,
      html: buildEmailHtml(report),
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}
```

### Email layout (`buildEmailHtml`)

```
┌─────────────────────────────────────────┐
│  Website Health Report                  │
│  example.com  ·  12 Jan 2026            │
├──────────┬──────────────────────────────┤
│ Score 74 │  Grade B — Good              │
│          │  2 critical · 4 important    │
│          │  3 minor                     │
├──────────┴──────────────────────────────┤
│ ● [critical] Broken internal link:      │
│   /products/old  (4 pages linked here)  │
│ ● [important] Broken image: /hero.jpg   │
│   (up to 10 issues shown)              │
├─────────────────────────────────────────┤
│  [ View Full Report → ]                 │
│  webhealthreport.pages.dev/report/:id   │
└─────────────────────────────────────────┘
```

Plain inline-CSS HTML — no external resources.

---

## Part 5 — UI

### Post-scan CTA (`src/pages/ScanProgress.jsx`)
Shown when scan status is `complete`, replace any monitor form with an account prompt:
- Banner: "Want weekly health reports? Create a free account to set up monitoring."
- Button: "Create account →" (links to `/register`)
- No inline scheduling from the report page.

### `/monitor` admin page (`src/pages/Monitor.jsx`)
Admin-only. Requires `?key=<MONITOR_SECRET>` in the URL; shows "Access denied" if missing/wrong.
- Table: domain · emails · next scan due · last scanned · [Remove]
- Add site form at top (URL + comma-separated emails)
- This is the **only** place scans can be scheduled in Phase 2.

### `/register` page (`src/pages/Register.jsx`) — stub
Phase 2 only needs a placeholder. Show a "Coming soon — account registration" message.
Actual auth/account system is deferred to a future phase.

Add `/monitor` and `/register` routes to `src/App.jsx`.

---

## Files to create / modify

| File | Action |
|------|--------|
| `schema.sql` | Add `monitored_sites` table + `claimed_at` on `crawl_queue` |
| `functions/_lib/scan-engine.js` | **New** — `processBatch()` from `status.js` |
| `functions/_lib/scan-bootstrap.js` | **New** — scan creation from `scans/index.js` |
| `functions/api/scans/[id]/status.js` | Slim wrapper calling `processBatch` |
| `functions/api/scans/index.js` | Slim wrapper calling `bootstrapScan` |
| `functions/api/monitored-sites/index.js` | **New** — POST + GET |
| `functions/api/monitored-sites/[id].js` | **New** — DELETE |
| `scheduler/wrangler.toml` | **New** |
| `scheduler/index.js` | **New** — cron + queue consumer + DLQ cleanup |
| `scheduler/email.js` | **New** — Resend + HTML builder |
| `src/pages/ScanProgress.jsx` | Replace monitor form with "Create account" CTA |
| `src/pages/Monitor.jsx` | **New** — admin-only scheduling page |
| `src/pages/Register.jsx` | **New** — stub "coming soon" page |
| `src/App.jsx` | Add `/monitor` and `/register` routes |

---

## Deployment steps

```powershell
# 1. Create Queues (one-time, run from project root)
npx wrangler queues create webhealthreport-scans
npx wrangler queues create webhealthreport-scans-dlq

# 2. Deploy Pages app (schema migration + new API endpoints)
./deploy.ps1

# 3. Set scheduler secrets and deploy
cd scheduler
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put MONITOR_SECRET
npx wrangler deploy
```

---

## Error handling summary

| Failure | Handling |
|---------|----------|
| Bootstrap fails (site unreachable) | Catch → release `pending_scan_id` → skip site |
| `processBatch` throws | Catch → retry with 60s delay; at attempt 20: release mutex + ack |
| Scan reaches `failed` status | Release `pending_scan_id` + ack (no retry) |
| Email fails | Log error; `next_scan_at` still advances, site still unlocked |
| Max retries exhausted (DLQ) | DLQ consumer clears `pending_scan_id` so site scans again next week |
| Duplicate cron invocations | Atomic `UPDATE ... WHERE pending_scan_id IS NULL` — only one invocation wins |
