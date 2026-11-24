# Monitored job deletion

Objective: fix removal of previously run monitoring jobs for admins and normal users.

Status: implemented, verified, and deployed to production on the user's explicit `deploy` instruction. Originally completed on `fix/monitored-job-deletion`, based on local master (four existing commits ahead of origin/master after fetch). Initial worktree was clean. The changes were preserved as dependencies of the subsequent production hardening and are included in the user-requested commit on `security/production-hardening`; that checkpoint records the final security behavior and rollout.

Decisions and boundaries:
- DELETE handlers retain admin authentication and user ownership checks. A shared database helper atomically detaches scans and removes the site; existing reports and scan data remain accessible by scan ID. Site-specific suppressions/history use existing cascading foreign keys. No schema migration is needed.
- Return success only when a row was deleted; repeated/missing/foreign-owned requests return 404. A failed database batch must leave the site and its associations intact. User billing remains best effort, after confirmed deletion.
- Reuse deletion cleanup in scheduled expiration. A scan already in progress must tolerate removal during finalization without reinserting issue history for a deleted site or emailing it.

Verification:
- Reproduced five failures before the fix: admin FK rejection, partial user cleanup on failure, duplicate user billing updates, removed-site scan retries, and scheduler expiration FK rejection.
- `npm.cmd run test:api`: 14/14 pass with disposable local D1 bindings, signed test JWTs, and mocked external services. Covers report/data retention, cascade cleanup, rollback, ownership/authentication, repeated/concurrent deletion, PayPal failures, active scans, and scheduled expiration.
- `npx.cmd playwright test tests/job-deletion.spec.js --workers=1`: 6/6 pass, covering actual admin/account UI and API clients with local authentication/API stubs (success after response, failure preservation, confirmation cancellation).
- Full Playwright suite: 25 pass / 19 fail. Archived original HEAD `1f5f266` into ignored `.wrangler/deletion-baseline`, served separately on port 5174, and ran its original 38 tests: 19 pass / the same 19 fail. Failures are existing stale/ambiguous selectors and expectations in home/report/progress tests; those sources and tests are unchanged.
- `npm.cmd run build`, Pages Functions build, scheduler `wrangler deploy --dry-run`, and `git diff --check` pass. No lint/typecheck script is configured. Existing Browserslist age and scheduler experimental-secrets warnings remain.
- Final review: parameterized SQL, ownership on both transaction writes, atomic rollback, unchanged report IDs, billing only after an actual user deletion. Product behavior documented in PRODUCT.md; durable lesson in docs/lessons.md.

Deployment (2026-10-27):
- Confirmed authenticated Cloudflare account, production project, matching production environment values, D1 binding ID, and compatibility date before uploading. Existing frontend build settings are configured in ignored `.env.local`.
- Scheduler deployed with `--keep-vars`; version `6dd91d6b-240f-40f2-8a47-161693cae30f`. Confirmed cron `*/15 * * * *`, producer and consumer for `webhealthreport-scans`, and DLQ consumer.
- Pages deployed to production using the existing project workflow; deployment `93561205`, URL https://93561205.webhealthreport.pages.dev, production https://webhealthreport.pages.dev. Rebuilt frontend successfully immediately before deployment.
- 14 live smoke checks passed across the exact deployment URL and production domain: home/admin/account pages, frontend bytes matching the local build, unauthenticated DELETE rejection for both roles, and a missing-report lookup exercising the production database. Verification changed no existing jobs. Detailed results and the verification script are in ignored `.wrangler/` artifacts.
- No schema migration or secret changes were required.

Remaining: no implementation or deployment work. Existing browser-suite failures are outside this task.
