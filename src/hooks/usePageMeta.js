import { useEffect } from 'react';

const BASE = 'https://webhealthreport.pages.dev';
const DEFAULT_TITLE = 'Website Health Report — Free Website Scanner';
const DEFAULT_DESC = 'Scan your website for broken links, missing pages, and technical issues in minutes. Free, no account required.';

export function usePageMeta({ title, description, path }) {
  useEffect(() => {
    document.title = title;

    let canonical = document.querySelector('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.setAttribute('rel', 'canonical');
      document.head.appendChild(canonical);
    }
    canonical.setAttribute('href', `${BASE}${path}`);

    const desc = document.querySelector('meta[name="description"]');
    if (desc && description) desc.setAttribute('content', description);

    return () => {
      document.title = DEFAULT_TITLE;
      const c = document.querySelector('link[rel="canonical"]');
      if (c) c.setAttribute('href', `${BASE}/`);
      const d = document.querySelector('meta[name="description"]');
      if (d) d.setAttribute('content', DEFAULT_DESC);
    };
  }, [title, description, path]);
}
