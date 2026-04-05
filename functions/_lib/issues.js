/**
 * Issue detection rules, fingerprinting, severity assignment.
 */

// Status codes commonly returned by bot-detection systems on otherwise-working sites.
// Treat these as "likely reachable" rather than broken.
const BOT_BLOCKED_STATUSES = new Set([403, 426, 429, 526, 530, 999]);

function pushTo(map, key, val) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(val);
}

export function detectIssues(scanId, pages, linkChecks, internalSourceMap = null, baseDomain = null) {
  const issues = [];

  // Single pass over linkChecks — build four grouped Maps simultaneously
  const internalBroken = new Map();
  const imageBroken    = new Map();
  const redirectChainMap = new Map();
  const externalBroken = new Map();

  for (const lc of linkChecks) {
    const key = lc.normalized_target_url || lc.target_url;
    if (lc.target_type === 'internal') {
      if (lc.response_status !== null && lc.response_status >= 400)
        pushTo(internalBroken, key, lc);
      if (lc.redirect_count >= 2)
        pushTo(redirectChainMap, key, lc);
    } else if (lc.target_type === 'image') {
      if ((lc.response_status === null || lc.response_status >= 400) &&
          !BOT_BLOCKED_STATUSES.has(lc.response_status))
        pushTo(imageBroken, key, lc);
    } else if (lc.target_type === 'external') {
      if ((lc.response_status === null || lc.response_status >= 400) &&
          !BOT_BLOCKED_STATUSES.has(lc.response_status))
        pushTo(externalBroken, key, lc);
    }
  }

  // ---- Broken internal links ----
  for (const [target, srcs] of internalBroken) {
    const severity = srcs.length >= 3 ? 'critical' : 'important';
    issues.push({
      scan_id: scanId,
      issue_type: 'broken_internal_link',
      severity,
      fingerprint: fp(scanId, 'broken_internal_link', target),
      title: `Broken internal link: ${shortUrl(target)}`,
      explanation: `${srcs.length} page${srcs.length > 1 ? 's link' : ' links'} to this internal URL but it returns a ${srcs[0].response_status} error.`,
      recommended_action: 'Update or remove the link, or restore the missing page.',
      affected_count: srcs.length,
      target_url: target,
      example_json: JSON.stringify({
        target,
        anchorText: srcs[0].anchor_text || '',
        sources: srcs.slice(0, 3).map(s => s.source_url),
      }),
    });
  }

  // ---- Broken images ----
  for (const [target, srcs] of imageBroken) {
    issues.push({
      scan_id: scanId,
      issue_type: 'broken_image',
      severity: 'important',
      fingerprint: fp(scanId, 'broken_image', target),
      title: `Broken image: ${shortUrl(target)}`,
      explanation: srcs[0].response_status === null
        ? `This image could not be reached (DNS failure or network error) and appears broken on ${srcs.length} page${srcs.length > 1 ? 's' : ''}.`
        : `This image is missing (${srcs[0].response_status}) and appears broken on ${srcs.length} page${srcs.length > 1 ? 's' : ''}.`,
      recommended_action: 'Re-upload the image or update the reference to a valid URL.',
      affected_count: srcs.length,
      target_url: target,
      example_json: JSON.stringify({
        target,
        anchorText: srcs[0].anchor_text || '',
        sources: srcs.slice(0, 3).map(s => s.source_url),
      }),
    });
  }

  // ---- Redirect chains on internal links ----
  for (const [target, srcs] of redirectChainMap) {
    issues.push({
      scan_id: scanId,
      issue_type: 'redirect_chain',
      severity: 'important',
      fingerprint: fp(scanId, 'redirect_chain', target),
      title: `Redirect chain: ${shortUrl(target)}`,
      explanation: `This link goes through ${srcs[0].redirect_count} redirects before reaching its destination. Chains slow down pages and waste link equity.`,
      recommended_action: 'Update the link to point directly to the final destination URL.',
      affected_count: srcs.length,
      target_url: target,
      example_json: JSON.stringify({ target, finalUrl: srcs[0].final_url, redirectCount: srcs[0].redirect_count, sources: srcs.slice(0, 3).map(s => s.source_url) }),
    });
  }

  // ---- Broken external links ----
  for (const [target, srcs] of externalBroken) {
    issues.push({
      scan_id: scanId,
      issue_type: 'broken_external_link',
      severity: 'important',
      fingerprint: fp(scanId, 'broken_external_link', target),
      title: `Broken external link: ${shortUrl(target)}`,
      explanation: srcs[0].response_status === null
        ? 'This external link could not be reached (DNS failure or network error). The domain may no longer exist.'
        : `This external link returns a ${srcs[0].response_status} error. Visitors who click it will see an error.`,
      recommended_action: 'Remove or replace this external link.',
      affected_count: srcs.length,
      target_url: target,
      example_json: JSON.stringify({
        target,
        anchorText: srcs[0].anchor_text || '',
        status: srcs[0].response_status,
        sources: srcs.slice(0, 2).map(s => s.source_url),
      }),
    });
  }

  // ---- Homepage unavailable ----
  const homepage = pages.find(p => {
    try {
      const u = new URL(p.url);
      if (u.pathname !== '/' && u.pathname !== '') return false;
      if (baseDomain && u.hostname !== baseDomain) return false;
      return true;
    } catch { return false; }
  });
  if (homepage && homepage.status_code !== null && homepage.status_code >= 400) {
    issues.push({
      scan_id: scanId,
      issue_type: 'homepage_unavailable',
      severity: 'critical',
      fingerprint: fp(scanId, 'homepage_unavailable', homepage.url),
      title: 'Homepage is unavailable',
      explanation: `Your homepage returned a ${homepage.status_code} error. Visitors and search engines cannot access your site.`,
      recommended_action: 'Restore the homepage immediately — this is your most critical issue.',
      affected_count: 1,
      target_url: homepage.url,
      example_json: JSON.stringify({ url: homepage.url, status: homepage.status_code }),
    });
  }

  // Single pass over pages for missing_title, thin_page, slow_page
  for (const page of pages) {
    if (page.status_code !== 200 || !isHtmlPage(page)) continue;

    if (!page.title || page.title.trim() === '') {
      issues.push({
        scan_id: scanId,
        issue_type: 'missing_title',
        severity: 'minor',
        fingerprint: fp(scanId, 'missing_title', page.url),
        title: `Page has no title: ${shortUrl(page.url)}`,
        explanation: 'This page is missing a <title> tag. Titles help search engines and users understand what the page is about.',
        recommended_action: 'Add a descriptive title tag to this page.',
        affected_count: 1,
        target_url: page.url,
        example_json: JSON.stringify({ url: page.url }),
      });
    }

    if (page.text_length !== null && page.text_length < 200) {
      const incomingSource = internalSourceMap
        ? internalSourceMap.get(page.url)
        : linkChecks.find(lc => lc.normalized_target_url === page.url)?.source_url;
      const incoming = incomingSource ? { source_url: incomingSource } : null;
      issues.push({
        scan_id: scanId,
        issue_type: 'thin_page',
        severity: 'minor',
        fingerprint: fp(scanId, 'thin_page', page.url),
        title: `Thin or empty page: ${shortUrl(page.url)}`,
        explanation: `This page has very little visible text (${page.text_length} characters). It may appear blank or unhelpful to visitors.`,
        recommended_action: 'Add meaningful content to this page or remove it if it is no longer needed.',
        affected_count: 1,
        target_url: page.url,
        example_json: JSON.stringify({ url: page.url, textLength: page.text_length, sources: incoming ? [incoming.source_url] : [] }),
      });
    }

    if (page.response_ms > 3000) {
      issues.push({
        scan_id: scanId,
        issue_type: 'slow_page',
        severity: 'minor',
        fingerprint: fp(scanId, 'slow_page', page.url),
        title: `Slow page load: ${shortUrl(page.url)}`,
        explanation: `This page took ${(page.response_ms / 1000).toFixed(1)}s to respond, which may frustrate visitors.`,
        recommended_action: 'Investigate server performance, caching, or hosting for this page.',
        affected_count: 1,
        target_url: page.url,
        example_json: JSON.stringify({ url: page.url, responseMs: page.response_ms }),
      });
    }
  }

  return issues;
}

function fp(scanId, type, url) {
  return `${scanId}:${type}:${url}`;
}

function shortUrl(url) {
  try {
    const u = new URL(url);
    const full = u.hostname + u.pathname;
    return full.length > 60 ? full.slice(0, 60) + '…' : full;
  } catch {
    return url.length > 60 ? url.slice(0, 60) + '…' : url;
  }
}

function isHtmlPage(page) {
  return page.content_type && page.content_type.includes('text/html');
}

export function computeHealthScore(issues) {
  const criticalPenalty = Math.min(issues.filter(i => i.severity === 'critical').length * 20, 60);
  const importantPenalty = Math.min(issues.filter(i => i.severity === 'important').length * 5, 25);
  const minorPenalty = Math.min(issues.filter(i => i.severity === 'minor').length * 1, 10);
  return Math.max(0, 100 - criticalPenalty - importantPenalty - minorPenalty);
}

export function scoreGrade(score) {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 50) return 'D';
  return 'F';
}
