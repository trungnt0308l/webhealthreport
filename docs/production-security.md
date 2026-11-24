# Production security boundaries

This application uses a React SPA, Cloudflare Pages Functions, D1, hosted Auth0 login, PayPal, and a scheduled/queue Worker. It has no App Router, RSC, Server Actions, local signup/OTP/magic-link endpoints, application session cookies, filesystem uploads, or S3 keys.

## Active routes

| Surface | Server boundary |
| --- | --- |
| `POST /api/scans` | Exact origin, fail-closed Turnstile with hostname verification, IP rate limit, bounded input, public HTTPS crawler boundary |
| `GET /api/scans/:id/status`, `report` | SQL-scoped access: public one-off capability, owning Auth0 subject, or admin credential |
| `POST /api/scans/:id/email-report` | Public scans only, exact origin, IP rate limit, bounded email and MX/A verification |
| `/api/user/sites` and site/suppression mutations | JWT required inside each handler; owner-scoped SQL |
| `/api/monitored-sites` and site/suppression mutations | Admin credential required inside each handler, constant-time digest comparison |
| PayPal subscription/order operations | JWT, exact origin, rate limit, ownership, fixed provider origins, opaque provider identifiers |
| `POST /api/paypal/webhook` | RSA verification of original request bytes using an HTTPS-fetched PayPal certificate, bounded body, atomic state changes and replay marker |
| Scheduler | Cron and queue triggers only; workers.dev and version preview URLs disabled |

The diagnostic URL checker, manual scan HTTP trigger, and unpaid user site-creation endpoint are removed, together with their frontend callers. Unknown API paths and aliases return JSON 404; unsupported methods return 405. A single Pages middleware supplies no-store, no-referrer, noindex, clean error handling, and request policy. Authentication and ownership are also enforced inside the actual protected handlers.

SPA HTML shells contain no private data and can return 200 before client login. All record-bearing APIs independently enforce access. Admin credentials live only in React state and survive SPA navigation, not reloads; they are never put into URLs or browser storage. Auth0 callback destinations accept only safe relative paths. Third-party page analytics were removed because report capabilities and auth callback queries must not be collected.

## Report compatibility

Migration `006_security_boundaries.sql` preserves ownership separately from `site_id`, so deleting a monitoring job cannot turn its reports public. Existing attached scans are assigned to their site's owner; administrator-owned scans remain admin-only. Historical detached scans cannot reliably be distinguished from anonymous scans and become admin-only. New anonymous scans explicitly opt into public sharing and use 128-bit identifiers. Existing report data is retained.

## Outbound requests

All crawler requests, including redirect hops and discovered links/images, require HTTPS, port 443, DNS hostnames without credentials, and public A/AAAA answers. Literal IPv4/IPv6, private/link-local/metadata, mapped IPv6, transition ranges and reserved addresses are rejected. Redirects are manual and limited to eight. DNS has a two-second deadline, requests/body reads have a ten-second deadline, HTML is capped at 2 MiB, and other response bodies are discarded. Fixed Auth0, PayPal, Turnstile and Resend clients have exact host allowlists, refuse redirects, and bound MIME/time/bytes. Provider path IDs cannot contain separators, encoding, queries, nulls or traversal components.

DNS checking precedes Workers `fetch`; the platform performs its own connection resolution. The code does not pin TLS connections to the checked address. It must not be reused in a runtime with private-network access without connection-level egress enforcement; rebinding resistance is not independently established by these tests.

## Payment mutations

Subscription activation requires PayPal `ACTIVE`, matching owner and plan. A D1 transaction claims the subscription exactly once, updates billing and creates exactly one site. Starting a new one-site subscription requires removal of retained monitoring jobs; old jobs cannot be revived under a new entitlement.

User billing changes and signed webhook updates hold a per-user D1 lease. Captured orders require a completed capture, matching USD amount and ownership. Capture retries use a stable provider idempotency key and can read the order to resolve an uncertain capture. A captured addition stays pending until a fresh provider read confirms the effective recurring quantity. PayPal-funded quantity changes need buyer re-consent, and a successful revise response alone is insufficient. The account page follows approval URLs and resumes persisted pending work after reload. Reductions also remain visible until confirmed; another site change cannot overlap them. [PayPal quantity approval contract](https://developer.paypal.com/platforms/subscriptions/customize/change-quantity/).

Cron selection, shared scan processing and completion email each enforce active/grace entitlement. Cancelled and suspended subscriptions stop after the same grace deadline. Completed reports remain accessible to their owner even after entitlement expiry. Cancellation preserves the original deadline; signed event creation times prevent stale webhook state from undoing it. Webhook state changes and replay marker are one transaction; database, lock-contention or verification-service failures remain retryable.

Migration 007 adds pending billing state and leases. Previously captured orders remain legacy records and cannot be replayed into another site. Existing provider quantities have not been changed automatically. Read-only production preflight found one subscription with a stored site count of two and one actual user site; its effective PayPal quantity requires reconciliation through the owning account. No real customer payment, approval or refund was exercised during verification.

## Independent bypass review

A separate fresh read-only reviewer reproduced the cancelled/suspended monitoring, retained-site reactivation and unapproved recurring-quantity bypasses using actual source with in-memory SQLite/provider fixtures. All were fixed and covered with real local D1 regressions. Its targeted recheck also found a completed-report status regression, which was fixed and covered. The final recheck confirmed the original bypasses and that regression were closed, with no further immediate bypass established. Provider settings, real authenticated sessions and real payment approval were not part of that recheck.

## Checks

- `npm run test:api`: unit/handler regressions and real disposable D1 transactions, including concurrency and rollback.
- `npm run test:runtime`: builds the actual Pages Worker and checks routing, response policy and raw-byte signatures inside workerd, with outbound networking disabled except controlled fixtures.
- `npx playwright test tests/security.spec.js tests/job-deletion.spec.js --workers=1`: owner/admin report navigation, private progress, anonymous denial and deletion UI.
- `npm run build`; scheduler `wrangler deploy --dry-run`; `npm audit --omit=dev`; `git diff --check`.

No lint or type-check script is configured. The original browser suite has 19 known stale selector/expectation failures, documented in the deletion checkpoint. Production dependency audit is clean after the pinned React Router 7.18.6 upgrade. The full development-tool audit reports 40 findings (19 high); these tools are outside the shipped bundle and have not been comprehensively upgraded in this rollout.

## Provider limits and rollout

The only configured public domain is `webhealthreport.pages.dev`. Zone WAF and rate-limit rules cannot be installed on Cloudflare's shared pages.dev zone, and the available OAuth token has no WAF edit scope. Application limits return 429 with `Retry-After`, never Managed Challenge: five scan creations, three report emails, twenty billing writes, and thirty admin requests per IP per minute. D1 counters are atomic and are pruned hourly by the scheduler. These limits do not replace edge-level volumetric protection.

Auth0 owns signup, session cookies, and any hosted passwordless tokens. No tenant-management credential is available here. Hosted signup MX enforcement, token HMAC storage/TTL/attempts/consumption, hosted auth Origin checks, and session-cookie attributes therefore remain unmodified and unverified. Do not introduce local passwordless routes to approximate provider controls. These require a separate authorized Auth0 tenant configuration review.

Rollout applies the additive migration to the existing D1 database, deploys Pages to the existing `production` branch and the scheduler with existing bindings/secrets preserved, then checks anonymous access and removed routes on production and deployment aliases. Historical deployments connected to the same database must be retired after the new release is verified. Keep the provider inventory and live-check artifacts in ignored `.wrangler/`; do not retain response records or credentials in evidence. Do not roll back to an obsolete unprotected application version.
