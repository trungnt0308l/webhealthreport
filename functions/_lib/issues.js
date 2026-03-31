/**
 * Issue detection rules, fingerprinting, severity assignment.
 */

export function detectIssues(scanId, pages, linkChecks) {
  const issues = [];

  // Group link checks by normalized target
  const byTarget = new Map();
  for (const lc of linkChecks) {
    const key = lc.normalized_target_url;
    if (!byTarget.has(key)) byTarget.set(key, []);
    byTarget.get(key).push(lc);
  }

  // ---- Broken internal links ----
  const brokenInternal = linkChecks.filter(
    lc => lc.target_type === 'internal' &&
          lc.response_status !== null &&
          lc.response_status >= 400
  );
  if (brokenInternal.length > 0) {
    const grouped = groupByTarget(brokenInternal);
    for (const [target, srcs] of grouped) {
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
        example_json: JSON.stringify({
          target,
          anchorText: srcs[0].anchor_text || '',
          sources: srcs.slice(0, 3).map(s => s.source_url),
        }),
      });
    }
  }

  // ---- Homepage unavailable ----
  const homepage = pages.find(p => {
    try { return new URL(p.url).pathname === '/' || new URL(p.url).pathname === ''; } catch { return false; }
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
      example_json: JSON.stringify({ url: homepage.url, status: homepage.status_code }),
    });
  }

  // ---- Broken images ----
  const brokenImages = linkChecks.filter(
    lc => lc.target_type === 'image' &&
          lc.response_status !== null &&
          lc.response_status >= 400
  );
  if (brokenImages.length > 0) {
    const grouped = groupByTarget(brokenImages);
    for (const [target, srcs] of grouped) {
      issues.push({
        scan_id: scanId,
        issue_type: 'broken_image',
        severity: 'important',
        fingerprint: fp(scanId, 'broken_image', target),
        title: `Broken image: ${shortUrl(target)}`,
        explanation: `This image is missing (${srcs[0].response_status}) and appears broken on ${srcs.length} page${srcs.length > 1 ? 's' : ''}.`,
        recommended_action: 'Re-upload the image or update the reference to a valid URL.',
        affected_count: srcs.length,
        example_json: JSON.stringify({
          target,
          anchorText: srcs[0].anchor_text || '',
          sources: srcs.slice(0, 3).map(s => s.source_url),
        }),
      });
    }
  }

  // ---- Redirect chains on internal links ----
  const redirectChains = linkChecks.filter(
    lc => lc.target_type === 'internal' && lc.redirect_count >= 2
  );
  if (redirectChains.length > 0) {
    const grouped = groupByTarget(redirectChains);
    for (const [target, srcs] of grouped) {
      issues.push({
        scan_id: scanId,
        issue_type: 'redirect_chain',
        severity: 'important',
        fingerprint: fp(scanId, 'redirect_chain', target),
        title: `Redirect chain: ${shortUrl(target)}`,
        explanation: `This link goes through ${srcs[0].redirect_count} redirects before reaching its destination. Chains slow down pages and waste link equity.`,
        recommended_action: 'Update the link to point directly to the final destination URL.',
        affected_count: srcs.length,
        example_json: JSON.stringify({ target, finalUrl: srcs[0].final_url, redirectCount: srcs[0].redirect_count }),
      });
    }
  }

  // ---- Broken external links ----
  const brokenExternal = linkChecks.filter(
    lc => lc.target_type === 'external' &&
          lc.response_status !== null &&
          lc.response_status >= 400
  );
  if (brokenExternal.length > 0) {
    const grouped = groupByTarget(brokenExternal);
    for (const [target, srcs] of grouped) {
      issues.push({
        scan_id: scanId,
        issue_type: 'broken_external_link',
        severity: 'important',
        fingerprint: fp(scanId, 'broken_external_link', target),
        title: `Broken external link: ${shortUrl(target)}`,
        explanation: `This external link returns a ${srcs[0].response_status} error. Visitors who click it will see an error.`,
        recommended_action: 'Remove or replace this external link.',
        affected_count: srcs.length,
        example_json: JSON.stringify({
          target,
          anchorText: srcs[0].anchor_text || '',
          status: srcs[0].response_status,
          sources: srcs.slice(0, 2).map(s => s.source_url),
        }),
      });
    }
  }

  // ---- Missing page title ----
  for (const page of pages) {
    if (page.status_code === 200 && (!page.title || page.title.trim() === '')) {
      issues.push({
        scan_id: scanId,
        issue_type: 'missing_title',
        severity: 'minor',
        fingerprint: fp(scanId, 'missing_title', page.url),
        title: `Page has no title: ${shortUrl(page.url)}`,
        explanation: 'This page is missing a <title> tag. Titles help search engines and users understand what the page is about.',
        recommended_action: 'Add a descriptive title tag to this page.',
        affected_count: 1,
        example_json: JSON.stringify({ url: page.url }),
      });
    }
  }

  // ---- Thin page ----
  for (const page of pages) {
    if (page.status_code === 200 && page.text_length !== null && page.text_length < 200) {
      issues.push({
        scan_id: scanId,
        issue_type: 'thin_page',
        severity: 'minor',
        fingerprint: fp(scanId, 'thin_page', page.url),
        title: `Thin or empty page: ${shortUrl(page.url)}`,
        explanation: `This page has very little visible text (${page.text_length} characters). It may appear blank or unhelpful to visitors.`,
        recommended_action: 'Add meaningful content to this page or remove it if it is no longer needed.',
        affected_count: 1,
        example_json: JSON.stringify({ url: page.url, textLength: page.text_length }),
      });
    }
  }

  // ---- Slow pages ----
  for (const page of pages) {
    if (page.status_code === 200 && page.response_ms > 3000) {
      issues.push({
        scan_id: scanId,
        issue_type: 'slow_page',
        severity: 'minor',
        fingerprint: fp(scanId, 'slow_page', page.url),
        title: `Slow page load: ${shortUrl(page.url)}`,
        explanation: `This page took ${(page.response_ms / 1000).toFixed(1)}s to respond, which may frustrate visitors.`,
        recommended_action: 'Investigate server performance, caching, or hosting for this page.',
        affected_count: 1,
        example_json: JSON.stringify({ url: page.url, responseMs: page.response_ms }),
      });
    }
  }

  return issues;
}

function groupByTarget(linkChecks) {
  const map = new Map();
  for (const lc of linkChecks) {
    const key = lc.normalized_target_url || lc.target_url;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(lc);
  }
  return map;
}

function fp(scanId, type, url) {
  return `${scanId}:${type}:${url}`;
}

function shortUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname + u.pathname;
  } catch {
    return url;
  }
}

export function computeHealthScore(issues) {
  let score = 100;
  for (const issue of issues) {
    if (issue.severity === 'critical') score -= 20;
    else if (issue.severity === 'important') score -= 5;
    else if (issue.severity === 'minor') score -= 1;
  }
  return Math.max(0, score);
}

export function scoreGrade(score) {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 50) return 'D';
  return 'F';
}
