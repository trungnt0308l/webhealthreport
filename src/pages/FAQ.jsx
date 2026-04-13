import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { usePageMeta } from '../hooks/usePageMeta.js';

const FAQS = [
  {
    group: 'About the scanner',
    items: [
      {
        question: 'What does the scanner check?',
        answer: 'We check eight categories of issues: broken internal links, broken external links, broken images, redirect chains, missing page titles, thin pages, slow pages, and homepage availability. Every issue is ranked by severity (critical, important, or minor) and linked back to the page where it was found.',
      },
      {
        question: 'How many pages will it scan?',
        answer: 'Free one-off scans check up to 500 pages and 5,000 links. Monitored scans (with a free account) check up to 1,000 pages and 10,000 links. For most small and medium-sized websites either limit covers the entire site. If your site is larger, the scanner works through it systematically until the cap is reached.',
      },
      {
        question: 'Does it scan JavaScript-rendered content?',
        answer: 'No — we fetch raw HTML the same way Googlebot does on its first crawl pass. This means we find exactly the same broken links and missing pages that search engine crawlers encounter, which is the most actionable signal for SEO and usability.',
      },
      {
        question: 'How long does a scan take?',
        answer: 'Most sites complete in 30 seconds to 2 minutes. You can watch the progress live — every page and link appears in the feed as it is checked. Larger sites with hundreds of pages may take a little longer.',
      },
      {
        question: 'Is it really free?',
        answer: 'One-off scans are completely free with no account required — just paste your URL and go. Scans check up to 500 pages and 5,000 links. Weekly automated monitoring is a paid feature at $9/month per site (currently discounted from $19/month).',
      },
    ],
  },
  {
    group: 'About the issues',
    items: [
      {
        question: 'What is a broken internal link and why does it matter?',
        answer: 'A broken internal link is a link within your own site that returns a 4xx or 5xx HTTP error — usually a 404 Not Found. For visitors it is a dead end. For search engines it signals poor site quality and can prevent pages from being indexed. Internal links are entirely within your control, so they should always be fixed first.',
      },
      {
        question: 'What is a redirect chain?',
        answer: 'A redirect chain happens when a URL redirects to another URL that then redirects again before reaching the final destination. Each extra hop adds latency and dilutes the link equity passed to the final page. Chains of two or more redirects are flagged as an issue.',
      },
      {
        question: 'What is a "thin page"?',
        answer: 'A thin page is a page with very little text content — typically fewer than a hundred words of visible body text. Search engines may treat these as low-quality and rank them poorly, or exclude them from the index altogether. The fix is usually to add more useful content or to redirect the page to a more comprehensive one.',
      },
      {
        question: 'What does the health score mean?',
        answer: 'The health score is a number from 0 to 100. It starts at 100 and is reduced by weighted deductions for each issue found: critical issues have the largest impact, minor issues have a small impact. A score of 90–100 is rated A (excellent), 75–89 is B (good), 60–74 is C (needs attention), 40–59 is D (poor), and below 40 is F (critical issues present).',
      },
    ],
  },
  {
    group: 'About monitoring',
    items: [
      {
        question: 'What is weekly monitoring?',
        answer: 'Weekly monitoring automatically scans your site once a week and emails you a health report whenever new issues are detected. Monitored scans check up to 1,000 pages and 10,000 links — twice the one-off scan limit. It is the easiest way to catch broken links introduced by content updates, third-party site changes, or server migrations before your visitors or Google notices them.',
      },
      {
        question: 'How do I set up scheduled scans?',
        answer: 'Create an account and go to My Account. Click "Subscribe & add site", enter your URL, and complete the PayPal checkout. The first scan runs within 24 hours, and subsequent scans run weekly from then on. You can monitor multiple sites from the same account — each site is billed at $9/month.',
      },
      {
        question: 'Can I suppress false positives?',
        answer: 'Yes. On any report from a monitored site, authenticated users see a "Not an issue" button next to each finding. Clicking it permanently hides that specific issue from future reports without affecting other issues of the same type.',
      },
    ],
  },
  {
    group: 'Pricing & billing',
    items: [
      {
        question: 'How much does weekly monitoring cost?',
        answer: 'Weekly monitoring is $9/month per site — currently discounted from the regular price of $19/month. This is an early-access offer; lock in the lower rate now and it stays at $9/month for as long as you remain subscribed.',
      },
      {
        question: 'How does billing work?',
        answer: 'Billing is handled securely through PayPal. When you add your first site you subscribe to a monthly plan at $9/site. Each additional site added mid-billing-cycle is charged a prorated amount for the remaining days in the cycle, then included in your regular monthly renewal. You can pay with your PayPal balance, a linked bank account, or a debit/credit card.',
      },
      {
        question: 'Can I cancel anytime?',
        answer: 'Yes. You can cancel your subscription at any time from the My Account page. Your sites remain monitored for 3 days after cancellation, then monitoring pauses. There are no cancellation fees or lock-in periods.',
      },
      {
        question: 'What happens if my payment fails?',
        answer: 'If a payment fails you enter a 3-day grace period during which monitoring continues normally. If payment is not resolved within 3 days, monitoring for your sites pauses until the subscription is renewed. Your site data and history are retained for 30 days.',
      },
      {
        question: 'Can I monitor multiple sites?',
        answer: 'Yes. Each site is $9/month and is billed as part of a single consolidated subscription — you pay one monthly charge covering all your sites rather than separate charges per site. Add or remove sites at any time from the My Account page.',
      },
    ],
  },
];

function FAQItem({ question, answer }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-slate-200 py-4 last:border-0">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center justify-between w-full text-left gap-4"
      >
        <span className="font-semibold text-slate-800">{question}</span>
        <span className="text-slate-400 text-sm flex-shrink-0">{open ? '▲' : '▼'}</span>
      </button>
      {open && <p className="mt-3 text-slate-600 text-sm leading-relaxed">{answer}</p>}
    </div>
  );
}

export default function FAQ() {
  usePageMeta({
    title: 'FAQ — Website Health Report',
    description: 'Answers to common questions about how the website scanner works, what it checks, and how to fix the issues it finds.',
    path: '/faq',
  });

  useEffect(() => {
    const allItems = FAQS.flatMap(g => g.items);
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.id = 'ld-faq';
    script.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: allItems.map(item => ({
        '@type': 'Question',
        name: item.question,
        acceptedAnswer: {
          '@type': 'Answer',
          text: item.answer,
        },
      })),
    });
    document.head.appendChild(script);
    return () => document.getElementById('ld-faq')?.remove();
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-slate-200 bg-white px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <div className="w-7 h-7 bg-brand-600 rounded-md flex items-center justify-center text-white font-bold text-sm">W</div>
            <span className="font-semibold text-slate-800">Website Health Report</span>
          </Link>
          <nav className="flex items-center gap-5 text-sm">
            <span className="text-brand-600 font-semibold">FAQ</span>
            <Link to="/register" className="btn-primary py-1.5 px-3 text-sm">Get weekly reports</Link>
          </nav>
        </div>
      </header>

      <main className="flex-1 max-w-2xl mx-auto w-full px-6 py-14">
        <h1 className="text-3xl font-bold text-slate-900 mb-3">Frequently Asked Questions</h1>
        <p className="text-slate-500 mb-12">Everything you need to know about how the scanner works and what to do with the results.</p>

        {FAQS.map(group => (
          <section key={group.group} className="mb-10">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2">{group.group}</h2>
            <div className="card">
              {group.items.map(item => (
                <FAQItem key={item.question} question={item.question} answer={item.answer} />
              ))}
            </div>
          </section>
        ))}

        <div className="mt-12 card text-center py-10">
          <p className="text-slate-700 font-semibold text-lg mb-2">Ready to scan your site?</p>
          <p className="text-slate-500 text-sm mb-6">Free one-off scan — no account required. Or add weekly monitoring from <span className="font-medium text-slate-700">$9/month</span>.</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link to="/" className="btn-primary">Scan my site →</Link>
            <Link to="/register" className="btn-secondary">Get weekly reports →</Link>
          </div>
        </div>
      </main>

      <footer className="text-center text-xs text-slate-400 py-6 border-t border-slate-100">
        Website Health Report — checks up to 1,000 pages per scan
      </footer>
    </div>
  );
}
