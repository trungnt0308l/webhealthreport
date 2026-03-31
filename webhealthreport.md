# PRD — Weekly Website Health Report

## 1. Overview

### Product name

**Weekly Website Health Report**

### Product type

Subscription SaaS with a public on-demand scanner as the acquisition funnel

### Pricing

**$19/month/site**

### Product summary

A lightweight website health product for SMBs and small agencies.

Users first land on a public page, enter a URL, and start an on-demand scan. They see scan progress live on screen and receive an immediate report in the browser. Later, they can subscribe to receive the same style of report automatically every week.

### Core promise

**“Enter a URL, scan your website, see what’s broken, and get a simple weekly report that tells you what to fix first.”**

---

## 2. Problem

Small businesses often do not notice website issues until customers do:

* links break
* contact pages fail
* pages disappear
* images go missing
* redirects accumulate
* obvious website quality problems linger

Existing tools are often:

* too technical
* too broad
* too expensive
* built for SEO professionals
* not pleasant to read or forward

Users want:

* an instant scan they can try immediately
* visible scan progress so it feels trustworthy
* a report that is simple and professional
* weekly monitoring later if they find value

---

## 3. Product strategy

This product should be built in two layers:

### Layer 1 — Public scanner

A landing page where a user:

1. enters a URL
2. starts a scan
3. sees progress in real time
4. receives a browser-based report

This is the top-of-funnel and validation engine.

### Layer 2 — Weekly monitoring

A paid subscription that:

* reuses the same scan/report engine
* runs weekly on the backend
* emails a polished report
* stores issue history and changes over time

This lets the product prove value before asking for payment.

---

## 4. Goals

### Business goals

* Validate demand using a public scan experience first
* Turn scan users into paid weekly monitoring customers
* Keep infrastructure simple and cheap
* Make the product profitable at $19/month/site

### Product goals

* Show live progress during scans
* Produce a professional report that is easy to understand and act on
* Build one shared scan/report engine for both on-demand and weekly use
* Minimize false positives
* Keep the product narrow and useful

### Non-goals

This product is not:

* a full SEO suite
* a real-time uptime monitor
* an accessibility scanner
* a security scanner
* a form testing tool
* an enterprise website governance platform

---

## 5. Target users

### Primary

SMB owners and managers with public websites:

* clinics
* lawyers
* schools
* local services
* B2B businesses
* brochure sites
* small ecommerce sites

### Secondary

Small agencies managing client sites.

### User characteristics

* low to moderate technical knowledge
* want simple explanations
* care about trust and professionalism
* likely to forward reports to developers or staff

---

## 6. Core user stories

### Public scanner

* As a visitor, I want to enter my URL and scan it immediately so I can see whether this product is useful.
* As a visitor, I want live progress so I know the scan is actually doing something.
* As a visitor, I want a simple report at the end so I can understand my website issues quickly.

### Paid weekly monitoring

* As a customer, I want the same type of report delivered automatically every week.
* As a customer, I want the report to tell me what is new, what still needs attention, and what was fixed.
* As a customer, I want to click through to a dashboard if I need more detail.

### Internal/operator

* As the product operator, I want one shared crawl and report engine so the public scan and recurring scan remain consistent.
* As the product operator, I want strict crawl limits so scan cost stays predictable.

---

## 7. Product principles

1. **Landing-page first**
   The first product experience is an immediate scan, not signup friction.

2. **Email/report first**
   The value is in the report, not in a complicated dashboard.

3. **Simple and professional**
   Reports should look polished and easy to forward.

4. **Trust through visibility**
   During on-demand scans, users must see progress in real time.

5. **Cost-aware architecture**
   The product must stay cheap to run.

6. **One engine, two modes**
   On-demand scans and scheduled weekly scans should share the same scan pipeline and report logic.

---

## 8. Scope

## 8.1 MVP scope

### A. Public landing page scanner

* URL input
* start scan button
* live scan progress
* in-browser final report
* optional CTA to subscribe for weekly monitoring

### B. Core scan engine

* crawl site
* extract pages and links
* check targets
* detect issues
* produce summary report

### C. Persisted scan history

* store scans and findings
* allow report retrieval
* support later weekly diffing

### D. Weekly monitoring

* background scheduled scans
* weekly report generation
* email delivery
* dashboard history

### E. Billing

* PayPal subscription for weekly monitoring

---

## 8.2 Out of scope for MVP

* ownership verification
* authenticated/private crawling
* full JS rendering
* accessibility checks
* security scanning
* form submission testing
* white-labeling
* API
* advanced collaboration
* custom crawl rules UI
* WebSocket-based live transport unless needed later

---

## 9. Functional requirements

## 9.1 Public scanner landing page

The system must provide a landing page where the user can:

* enter a website URL
* start an on-demand scan
* see progress update live
* view the finished report in-browser

### Acceptance criteria

* user can paste a valid public URL
* scan begins without requiring payment
* progress updates appear automatically during scan
* final report is displayed without needing email delivery
* if the scan hits product limits, the UI explains that clearly

---

## 9.2 Live progress reporting

The system must expose scan status so the UI can update every 1–2 seconds.

### Progress data should include

* current state
* pages crawled
* links checked
* issues found so far
* human-readable current step

### Suggested step labels

* Starting scan
* Checking homepage
* Discovering pages
* Checking internal links
* Checking external links
* Analyzing issues
* Building report

### Acceptance criteria

* progress updates are visible during active scans
* user can refresh the page and continue seeing current status if the scan is still active
* the final state clearly transitions to complete or failed

---

## 9.3 Core crawling

The system must:

* fetch the starting page
* discover internal pages
* parse HTML where needed
* extract links and resources
* check the status of unique targets
* apply strict crawl limits

### Crawl limits

* max 500 pages
* max 10,000 links/resources checked
* max crawl depth, for example 5
* time budget per scan

### Acceptance criteria

* crawler stops safely when limits are reached
* duplicate targets are not checked repeatedly without reason
* crawl results are persisted for reporting

---

## 9.4 Issue detection

The system must detect and group:

### Broken internal links

* internal page links to a target returning 4xx/5xx

### Broken external links

* external target fails repeatedly or with sufficient confidence

### Redirect issues

* redirect chains
* redirect loops
* internal links pointing to redirected destinations unnecessarily

### Missing pages

* homepage unavailable
* contact page unavailable
* important page previously seen but now missing

### Broken images/media

* referenced key image/media returns an error

### Basic page-quality issues

* missing title
* duplicate title on important pages
* suspiciously thin or blank page
* major content shrinkage on important pages
* unusually slow key page response

### Acceptance criteria

* issue grouping is stable
* same root issue is not duplicated excessively
* high-value issues are clearly distinguishable from minor ones

---

## 9.5 Public report output

The system must generate a browser-based report after scan completion.

### Required sections

* overall health status
* summary counts
* top priorities
* new scan findings
* affected pages/examples
* recommended next steps
* CTA to subscribe for weekly monitoring

### Acceptance criteria

* report is understandable by a non-technical user
* report looks professional
* report is useful without requiring dashboard access

---

## 9.6 Scheduled weekly scans

The system must support backend jobs that:

* identify subscribed sites due for scan
* run the same scan engine in the background
* compare current scan with prior scan
* generate weekly report data
* trigger email delivery

### Acceptance criteria

* scheduled scans reuse the same core engine as public scans
* scan cadence is weekly only
* system can recover safely from failed jobs

---

## 9.7 Weekly change comparison

The system must compare each new scheduled scan with the prior scan and classify:

* new issues
* unresolved issues
* fixed issues

### Acceptance criteria

* issue lifecycle is visible in dashboard and weekly email
* comparison logic uses stable fingerprints where possible

---

## 9.8 Email reports

The system must send a weekly email report for subscribed sites.

### Email requirements

* simple to read
* professional-looking
* mobile-friendly
* easy to forward
* clear about what to do next

### Required email sections

* site/domain
* scan date
* health status
* critical/top issues
* new issues
* fixed issues
* unresolved count
* clear CTA to full report

### Acceptance criteria

* user can understand the report in under 30 seconds
* surfaced issues include clear recommended action
* report can be forwarded without embarrassment

---

## 9.9 Billing

The system must support:

* PayPal subscription creation
* subscription activation
* cancellation
* scan eligibility based on subscription status

### Acceptance criteria

* paid subscription is required for weekly monitoring
* public on-demand scan remains available without subscription
* cancelled subscription prevents future weekly scans after access ends

---

## 10. Non-functional requirements

### Simplicity

* jargon-free where possible
* clear progress states
* short reports

### Reliability

* scans should complete predictably within limits
* retries should not create duplicate results
* failed jobs should be traceable

### Performance

* public scan should show progress quickly
* scan engine should deduplicate aggressively
* writes should be batched where possible

### Cost control

* serverless-first
* no always-on backend required
* no full-page archival by default
* no default headless browser rendering

### Trust

* progress should feel real
* reports should avoid noisy false alarms

---

## 11. Architecture

## 11.1 Recommended stack

* **Frontend:** Next.js or Cloudflare Pages frontend
* **Backend/runtime:** Cloudflare Workers
* **Database:** Cloudflare D1
* **Billing:** PayPal
* **Email:** Postmark, Resend, or SES

## 11.2 Why D1

Use D1 for MVP because:

* it keeps the stack Cloudflare-native
* it reduces moving parts
* it is enough for the product’s relational needs
* it is appropriate for low-cost serverless operation

If the product later outgrows D1 query patterns or relational needs, database migration can be considered then.

---

## 12. Data model

### users

* id
* email
* password_hash or auth_provider_id
* created_at

### sites

* id
* user_id nullable for public scans if needed
* domain
* normalized_start_url
* active_status
* created_at
* next_scan_at
* last_scan_at
* is_subscribed

### subscriptions

* id
* user_id
* site_id
* provider
* provider_subscription_id
* provider_plan_id
* status
* current_period_end
* created_at

### scans

* id
* site_id nullable for one-off scan before full account linkage if desired
* scan_type (`public`, `scheduled`)
* status
* started_at
* finished_at
* pages_crawled
* links_checked
* summary_json

### pages

* id
* scan_id
* url
* normalized_url
* status_code
* content_type
* title
* content_hash
* response_ms

### link_checks

* id
* scan_id
* source_page_url
* target_url
* normalized_target_url
* target_type
* check_method
* response_status
* redirect_count
* final_url

### issues

* id
* scan_id
* site_id nullable
* issue_type
* severity
* fingerprint
* title
* explanation
* recommended_action
* lifecycle_status
* affected_count
* example_json

### reports

* id
* scan_id
* site_id nullable
* report_type (`browser`, `email`)
* rendered_summary_json
* created_at

### report_deliveries

* id
* report_id
* email_to
* provider
* delivery_status
* sent_at

### jobs

* id
* type
* payload_json
* status
* attempts
* available_at
* locked_at
* locked_by
* created_at

---

## 13. Technical design

## 13.1 Runtime roles

### Public scan worker

* receives new scan request
* creates scan record
* performs crawl in bounded steps
* updates progress state
* writes findings
* creates final report

### Status endpoint

* returns current scan progress and counts
* supports polling every 1–2 seconds

### Scheduled worker

* runs periodically
* finds sites due for weekly scan
* creates scheduled scan jobs

### Report/email worker

* performs diffing
* builds weekly report
* sends email
* stores delivery logs

---

## 13.2 Real-time progress transport

Start with **polling**, not WebSockets.

### Flow

1. user starts scan
2. backend returns scan ID
3. frontend polls scan status endpoint
4. when status is complete, frontend loads final report

### Why

* easier to build
* reliable enough for scan progress
* simpler operationally

---

## 13.3 Crawl performance strategy

### Use GET for HTML pages

Use full `GET` requests when:

* page body is needed
* HTML must be parsed
* links must be discovered
* titles/content signals must be extracted

### Use HEAD-first for many resources and external checks

Use `HEAD` first when:

* checking images
* checking PDFs/assets
* checking many external targets where only status matters

Fallback to `GET` when:

* HEAD fails suspiciously
* server behavior is unreliable
* you need additional validation

### Key performance rules

1. deduplicate normalized target URLs
2. check each unique target once per scan where possible
3. batch D1 writes
4. keep per-host concurrency modest
5. stop at strict limits
6. prioritize internal HTML discovery before deep external checking

---

## 13.4 URL normalization

Normalize:

* lowercase host
* strip fragments
* normalize trailing slash
* remove default ports
* strip common tracking params

This reduces redundant checks and noisy issue counts.

---

## 13.5 Storage strategy

Store only:

* normalized URLs
* titles
* response status
* response times
* content hashes
* issue fingerprints
* summary payloads

Do not store full raw HTML long term in MVP.

---

## 14. UX requirements

## 14.1 Landing page

Must include:

* clear value proposition
* URL input
* scan CTA
* optional supporting examples
* trust-building copy without overexplaining

## 14.2 Progress screen

Must show:

* current step label
* live counters
* progress state that feels active and trustworthy
* no technical clutter

## 14.3 Browser report

Must look:

* clean
* professional
* useful
* calm
* structured enough to skim

It should feel like a polished product result, not a debug dump.

## 14.4 Weekly email

Must share the same design language as the browser report.

---

## 15. Severity model

### Critical

* homepage unavailable
* contact page unavailable
* major navigation destination broken
* important page missing
* many sources linking to same broken internal page

### Important

* multiple broken internal links
* broken important external links
* redirect chains on important pages
* broken major images/resources

### Minor

* isolated dead links
* duplicate titles
* blank/thin lower-priority pages

---

## 16. Build phases

## Phase 1 — Landing page + live public scanner

Build:

* landing page
* URL input
* create scan endpoint
* live progress polling
* public scan report page
* D1 schema for scans/pages/link checks/issues/reports

### Outcome

User can enter a URL, watch a live scan, and get a report.

---

## Phase 1.5 — Persistence and report quality

Build:

* stable scan persistence
* issue grouping
* polished browser report
* recommended action text
* subscription CTA from report

### Outcome

Public scan becomes a strong acquisition and validation tool.

---

## Phase 2 — Backend job system

Build:

* job model
* scheduled worker
* reusable scan pipeline for backend execution
* failure handling and retries
* scan history linkage to sites

### Outcome

The scan engine can run without a user waiting on screen.

---

## Phase 3 — Weekly monitoring and reporting

Build:

* site registration for recurring scans
* weekly scheduling
* comparison against prior scan
* new/unresolved/fixed classification
* professional email report generation
* email delivery logging

### Outcome

Subscribed sites receive automatic weekly reports.

---

## Phase 4 — Billing

Build:

* PayPal subscription setup
* subscribe flow
* webhook processing
* subscription status UI
* gating of recurring scans to active subscribers

### Outcome

Users can upgrade from public scan to paid weekly monitoring.

---

## Phase 5 — Dashboard and polish

Build:

* site overview
* report history
* issue detail
* subscription management
* better retry logic
* support/admin tools
* false-positive reduction

### Outcome

More complete product for retained customers.

---

## 17. Success metrics

### Public scanner

* landing page conversion to scan start
* scan completion rate
* time to first visible progress update
* report view rate
* upgrade intent / CTA click rate

### Weekly monitoring

* paid conversion rate from scan users
* weekly email open rate
* click-through rate
* churn after 1–3 months
* sites per paying account
* support load per paying account

### Product quality

* false positive rate
* scan success rate
* average scan cost
* average scan duration

---

## 18. Risks

### 1. Public scans are expensive or slow

Mitigation:

* strict limits
* dedupe aggressively
* GET/HEAD hybrid strategy
* bounded concurrency

### 2. Report quality is not compelling

Mitigation:

* invest early in polished browser report
* make recommendations clear
* prioritize issues well

### 3. Public scans create abuse risk

Mitigation:

* rate-limit scans per IP/account
* cap pages and links
* low scan frequency
* queue control

### 4. D1 limitations appear later

Mitigation:

* keep schema simple
* avoid overcomplicated relational patterns
* revisit database choice only if necessary

### 5. Public scanner converts poorly to paid

Mitigation:

* ensure report shows clear ongoing value
* position weekly monitoring as “same report, automatically every week”

---

## 19. Launch positioning

### Headline

Scan your website and see what’s broken in minutes.

### Subheadline

Enter your URL, watch the scan live, and get a professional report showing broken links, missing pages, and the website issues that matter most.

### Paid upgrade message

Get this report automatically every week for **$19/site/month**.

---

## 20. Final definition

**Weekly Website Health Report** starts as a public, live website scanner and expands into a paid weekly monitoring service.

The first experience is immediate:

* enter URL
* watch progress
* get report

The paid experience is recurring:

* same engine
* same style of report
* delivered automatically every week

The product succeeds if the scan feels trustworthy, the report feels professional, and the weekly subscription feels like the obvious next step.
