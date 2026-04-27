import { useEffect } from 'react';

const BASE = 'https://webhealthreport.pages.dev';
const DEFAULT_TITLE = 'Website Health Report — Free Website Scanner';
const DEFAULT_DESC = 'Scan your website for broken links, missing pages, and technical issues in minutes. Free, no account required.';

function setMeta(selector, attr, value) {
  const el = document.querySelector(selector);
  if (el && value) el.setAttribute(attr, value);
}

export function usePageMeta({ title, description, path }) {
  useEffect(() => {
    const url = `${BASE}${path}`;

    document.title = title;

    let canonical = document.querySelector('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.setAttribute('rel', 'canonical');
      document.head.appendChild(canonical);
    }
    canonical.setAttribute('href', url);

    setMeta('meta[name="description"]', 'content', description);
    setMeta('meta[property="og:title"]', 'content', title);
    setMeta('meta[property="og:description"]', 'content', description);
    setMeta('meta[property="og:url"]', 'content', url);
    setMeta('meta[name="twitter:title"]', 'content', title);
    setMeta('meta[name="twitter:description"]', 'content', description);

    return () => {
      document.title = DEFAULT_TITLE;
      const c = document.querySelector('link[rel="canonical"]');
      if (c) c.setAttribute('href', `${BASE}/`);
      setMeta('meta[name="description"]', 'content', DEFAULT_DESC);
      setMeta('meta[property="og:title"]', 'content', DEFAULT_TITLE);
      setMeta('meta[property="og:description"]', 'content', DEFAULT_DESC);
      setMeta('meta[property="og:url"]', 'content', `${BASE}/`);
      setMeta('meta[name="twitter:title"]', 'content', DEFAULT_TITLE);
      setMeta('meta[name="twitter:description"]', 'content', DEFAULT_DESC);
    };
  }, [title, description, path]);
}
