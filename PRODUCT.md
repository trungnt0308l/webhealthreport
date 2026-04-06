# Website Health Report — Product Overview

## What It Is

Website Health Report is a free website scanner that crawls your site and produces a prioritised list of technical issues affecting SEO, user experience, and site reliability. No account is required to run a scan. Results are available within minutes.

---

## Core Value Proposition

- **No friction entry**: paste a URL, click scan, get a report. No sign-up, no credit card, no installation.
- **Googlebot-accurate**: crawls raw HTML the same way search engines do on their first pass — finds exactly the issues that affect indexing and rankings.
- **Actionable output**: every issue links back to the exact page it was found on, with a plain-English explanation and a recommended fix.

---

## Features

### Free One-Off Scan (No Account Required)
- Enter any publicly accessible URL and scan immediately
- Checks up to **500 pages** and **5,000 links** per scan
- Live progress feed — watch pages and links being checked in real time
- Full report available as soon as the scan completes
- Turnstile bot protection keeps the service fast and fair

### Health Score & Grading
- Every scan produces a **health score (0–100)** and a **letter grade (A–F)**
- Score reflects the number, severity, and spread of issues found
- At-a-glance summary: pages scanned, links checked, issues found

### Issue Detection — 8 Categories

| Issue | Severity | Why It Matters |
|-------|----------|----------------|
| Broken internal links | Critical / Important | Blocks visitors and search crawlers; prevents page indexing |
| Broken external links | Important | Damages credibility; wastes crawl budget |
| Broken images | Important | Leaves blank spaces; degrades user experience |
| Redirect chains (2+ hops) | Important | Slows page loads; dilutes link equity |
| Missing page titles | Minor | Direct ranking signal; hurts click-through rates in search results |
| Thin / empty pages | Minor | Low-quality signal for search engines; poor user experience |
| Slow pages (>3 s response) | Minor | Increases bounce rate; hurts Core Web Vitals |
| Homepage unavailable | Critical | Most severe issue — site is unreachable for visitors and search engines |

Each issue includes:
- Title and affected URL
- Plain-English explanation of the problem
- Specific recommended action
- Affected page count
- Example source pages where the issue was found

### Severity Tiers
- **Critical** — fix immediately (homepage down, widely linked broken pages)
- **Important** — fix soon (broken links, broken images, redirect chains)
- **Minor** — fix as part of regular maintenance (thin content, slow pages, missing titles)

---

## Free Account — Weekly Monitoring

Sign up for a free account (Google or email) to unlock automated monitoring:

- Add one or more sites to your account
- Automatic weekly scans with **no manual trigger required**
- Higher scan limits: up to **1,000 pages** and **10,000 links** per scan
- **Email health reports** delivered to your inbox after every scan
- Support for **multiple email recipients** per site — share reports with your team, client, or agency
- Issue history tracking — see when each issue was first detected
- **Issue suppression** — hide false positives or known non-issues from your reports without affecting the score

---

## Who It's For

| Audience | Use Case |
|----------|----------|
| Small business owners | Catch broken links before customers do; verify the site is healthy after updates |
| Freelance web developers | Deliver a health report as part of every project handoff |
| SEO consultants | Identify technical issues affecting crawlability and rankings |
| Marketing agencies | Monitor client sites automatically; branded-style deliverable |
| In-house marketing teams | Weekly confidence check that nothing broke after a content push |

---

## Differentiators

- **Instant, no-login scan** — lowest friction of any comparable tool
- **Raw HTML crawl** — matches what Googlebot actually sees, not what JavaScript renders
- **Live feed** — users see results as they happen, not a spinner for 2 minutes
- **Plain-English issues** — no jargon; every issue has a recommended action a non-technical person can understand
- **Free tier is genuinely useful** — 500 pages covers most small and medium sites completely
- **Weekly automated monitoring for free** — most competing tools charge for scheduling

---

## Scan Limits Summary

| Plan | Pages per scan | Links per scan | Frequency |
|------|---------------|----------------|-----------|
| Guest (no account) | 500 | 5,000 | On demand |
| Free account | 1,000 | 10,000 | Weekly (automated) + on demand |

---

## How a Scan Works (Technical Summary for Trust-Building Copy)

1. Seeds the crawler with the entered URL
2. Fetches each internal HTML page (up to 250 links and 250 images extracted per page)
3. Checks all discovered external links and images via HTTP HEAD requests
4. Detects issues in a single analysis pass after crawling completes
5. Produces a scored, graded report with prioritised findings

Crawl depth is capped at 5 levels. Tracking URLs, analytics pixels, and ad beacons are automatically excluded.
