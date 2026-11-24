# Production hardening

Objective: remove unnecessary routes, structurally harden active boundaries, add regressions, deploy and verify anonymously, then obtain a fresh read-only bypass review.

Status: application hardening deployed and verified; independent review and targeted recheck complete. Provider limitations remain documented. Branch `security/production-hardening` starts at `1f5f266` after fetching origin, and preserves the previously deployed, uncommitted monitored-job-deletion changes.

Architecture and decisions:
- Vite/React SPA, Pages Functions, D1, Auth0 hosted authentication, PayPal, and a cron/queue Worker. No Next.js, Server Actions, local signup/OTP/magic-link handlers, session cookies, filesystem storage, or S3.
- Retain the actively used admin monitoring dashboard/API. Remove its diagnostic URL checker. Scheduler has no HTTP handler; disable public Worker routes explicitly.
- Server handlers own authentication and resource ownership; client guards only control navigation. Anonymous one-off reports remain capability URLs. Monitored scans require owner/admin access, including after site deletion; preserve access scope independently of the foreign key.
- A shared outbound boundary must cover initial URLs, discovered links/images, and each redirect, with bounded DNS/time/body/MIME handling. Fixed service clients use exact hosts, opaque path identifiers, no redirects, and bounded responses.
- Central API response policy owns no-store, origin checks, errors, unsupported methods, retired paths, and request body limits. Handler-level auth remains mandatory.
- Hosted Auth0 signup/token policies require separate tenant access; do not create unused local auth endpoints to emulate them.

Verification: 88 API/D1 tests, two workerd tests and twelve focused browser checks pass. Coverage includes concurrency/rollback, DNS deadlines/redirect hops, Turnstile fail-closed behavior, HTTP 429, payment consent/resumption, stale webhooks and retained terminal reports. Production build, scheduler packaging and diff checks pass. Production npm audit has zero findings after pinning React Router 7.18.6. Full browser suite: 31 pass / the original 19 stale failures. Full development-tool audit reports 40 findings (19 high), distinct from the zero findings among production dependencies. No lint/type-check script exists.

Provider preflight: correct Cloudflare account/project/D1 confirmed. Production has all expected secret names; values never extracted. OAuth refreshed after expiry. Only pages.dev is configured, with no available WAF permissions. No Auth0 tenant-management access. Inventory contains 94 prior deployments (84 production, ten preview); the user explicitly approved deleting them after verification of the new release.

Runtime finding fixed: Node-style RSA verification rejected X509Certificate.publicKey in workerd even though Node tests passed; export SPKI and use Web Crypto. Regression exercises the actual built Worker with controlled certificate fixtures.

Rollout (2026-11-24):
- Migration 006 applied to D1 `c379e50c-5790-46da-88fa-83c5b82ebeb0`; bookmark `00005706-00000006-0000512d-c69444c61061ddcdebf118204aef7e29`.
- Pages production deployment `e0a03fc0-6f5c-4f94-ab03-38d58e197f64`; scheduler version `bd2f79e7-89f9-458a-9a8f-16ea1196238a`, existing cron/queues preserved.
- Provider comparison confirms existing vars, secret names and D1 bindings retained; only expected nodejs_compat added. Counts unchanged: eight sites, 441 scans, 435 reports, one subscription.
- 74 curl/shell checks pass on production and exact deployment URL, including an existing restricted report, every protected API mutation, retired routes, aliases, unsupported methods, no-store/no-referrer and CSP. Error bodies contain zero records.
- All 94 user-approved obsolete snapshots deleted. Provider lists one deployment. 96 retired-host checks return 404, including master alias and scheduler workers.dev. Scheduler workers.dev and version previews verified disabled.
- Isolated live browser: mobile home renders without overflow or analytics; invalid admin login denied; account redirects to configured Auth0. Zero CSP violations. Full real scan not attempted because headless Turnstile did not issue a token; authenticated live owner/payment/email flows need real user/provider credentials. Local regressions cover those boundaries with controlled fixtures.
- Evidence/scripts are in ignored `.wrangler/hardening-*`, `verify-hardening-live.mjs`, `verify-retired-hosts.mjs` and `browser-hardening-live.mjs`; no private response records or production credentials retained.

Independent reviewer found three pre-existing entitlement bypasses: cancelled/suspended monitoring remained eligible, retained sites could be revived under a new one-site subscription, and captured additions were granted before PayPal quantity re-consent. Controlled SQLite/provider-fake repros confirmed them. All were fixed. Its recheck found a terminal-report status regression, which was fixed with a dedicated regression. Final independent in-memory SQLite recheck confirmed all original bypasses and that regression were closed, with no additional immediate bypass found.

Billing state/boundaries: per-user D1 leases serialize app billing and webhook writes; bounded provider calls complete within the lease under normal service semantics. Captured orders preserve input and remain pending until a fresh PayPal read confirms effective quantity; approval URLs are exact-host HTTPS and account UI resumes pending work after reload. Activation cannot carry retained sites into a one-site plan. Cron launch, shared scan processing and completion email each enforce subscription/grace eligibility. Signed event creation times fence stale webhook state, and cancellation preserves the original grace deadline. Existing captured legacy orders are not reactivated by the new retry flow.

Final rollout:
- Migration 007 applied; bookmark `00005715-00000006-0000512d-8da7afbbdbcb815bd15b9bfd8dae54ef`.
- Current Pages production deployment `cfffe0a4-990b-48cb-9fc3-78631c3b514b`, https://cfffe0a4.webhealthreport.pages.dev ; production https://webhealthreport.pages.dev.
- Scheduler version `2cba74d9-f1ba-4488-a3a5-7c5126c8cfbb`; cron, queues, bindings and secret names retained. workers.dev/version URLs remain disabled.
- Final 84 live curl/content checks pass across production and deployment hosts, including an existing restricted scan, every protected API, removed paths, encoded/case/trailing-slash aliases, no-store/no-referrer/noindex/CSP and exact frontend bytes. Zero records in denied API responses.
- Live mobile/browser checks repeated: homepage, invalid admin rejection and hosted Auth0 redirect pass with zero CSP violations. Real scan skipped because headless Turnstile issued no token.
- 96 obsolete snapshots removed in total (94 approved old snapshots plus two superseded task releases). All 98 retired-host checks return 404; provider lists exactly one deployment.
- Final counts: eight monitored sites, 442 scans, 435 reports, one subscription. One scan was added while the scheduler remained active; verification created no live scans, payments, emails or user records. A read-only billing preflight found stored site_count two versus one actual user site; effective provider quantity was not changed or independently verified.

Remaining limits: pages.dev cannot receive zone WAF rules; Auth0 hosted signup/passwordless/cookie settings remain unmodified without tenant access (no Auth0 connector was found); connection-level DNS pinning is not established by Workers fetch prechecks. Real authenticated payment/email approval and historical billing reconciliation remain unverified; controlled fixtures cover their code contracts. All authorized application implementation, deployment, independent review and available live checks are complete. The user requested a commit; this checkpoint is included with the verified hardening and its monitored-job-deletion dependencies on `security/production-hardening`. No push was requested.
