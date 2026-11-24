# Lessons

Current index:
- [Monitoring job deletion and foreign keys](#monitoring-job-deletion-and-foreign-keys) (2026-10-27)
- [Verify cryptography in workerd and retire old hosts](#verify-cryptography-in-workerd-and-retire-old-hosts) (2026-11-24)
- [Payment approval is an entitlement boundary](#payment-approval-is-an-entitlement-boundary) (2026-11-24)

## Monitoring job deletion and foreign keys

Cause: `scans.site_id` references `monitored_sites.id` without a delete action. Direct admin deletion failed after a scan existed. The user path detached scans in separate writes, so a failed delete left partial cleanup and two simultaneous deletes could both trigger billing changes. Active scan finalization also attempted to insert history referencing a removed site.

Prevention: use the shared `deleteMonitoredSite` helper in admin, owner, and scheduled-expiration paths. Detach scans and delete the site in one D1 batch, scope both statements to the owner where applicable, and check the actual delete count before billing. Retain scan records; existing cascades clean up site-only history/suppressions. Insert new history with `INSERT ... SELECT` against an existing site and skip completion email when the site no longer exists.

Regression checks: `npm.cmd run test:api` uses real local D1 foreign-key and transaction behavior with synthetic data. `npx.cmd playwright test tests/job-deletion.spec.js --workers=1` checks both dashboards with stubbed authentication/API responses. Include multiple completed scans, an active scan, forbidden ownership, forced database failure, and simultaneous deletion.

References: [D1 batch transactions](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch), [D1 foreign keys](https://developers.cloudflare.com/d1/sql-api/foreign-keys/).

## Verify cryptography in workerd and retire old hosts

Cause: Node tests accepted an RSA verifier using `X509Certificate.publicKey`, but workerd rejected that key object. Separately, shipping a protected Pages release leaves older deployment URLs pointing at their original code and potentially the same production D1 database.

Prevention: run the actual built Worker with the configured compatibility flags. Export certificate SPKI and use Web Crypto verification across both runtimes. Inventory production, preview, branch-alias and workers.dev/version URLs before claiming rollout protection; retire obsolete snapshots only with explicit authorization and after the replacement passes live checks. Preserve access ownership independently of deletable foreign keys.

Regression checks: `npm run test:runtime` verifies valid and modified raw webhook bytes in workerd. `npm run test:api` verifies owner access after deletion and atomic billing/webhook writes. Live rollout checks must cover both the current deployment and production domain, then verify retired hosts return 404 and provider inventory contains no older reachable version.

## Payment approval is an entitlement boundary

Cause: PayPal accepted a quantity revision request before the buyer approved it, while the application immediately granted a new site. Concurrent absolute quantity revisions could also arrive out of order. Cancellation/suspension labels bypassed a cron filter that checked only payment-failure grace; reactivation could retain older sites under a new one-site plan.

Prevention: serialize user billing writes; keep captured additions pending until a fresh provider read confirms effective quantity; persist input and approval work across retries/reloads. Block overlapping changes and retained-site reactivation. Enforce entitlement at cron selection, shared processing and email completion. Preserve terminal reports before evaluating whether further work is allowed, and fence stale signed billing events.

Regression checks: real local D1 tests cover expired states, retained jobs, concurrent distinct orders, unapproved revisions, atomic rollback/retry, stable capture idempotency, stale activation events and terminal-report retention. Browser checks verify the approval redirect and pending state after reload. Keep real-money approval validation separate from controlled fixtures and report its absence.
