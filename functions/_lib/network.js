// All untrusted crawler traffic crosses this boundary, including redirects.
export const HTML_LIMIT = 2 * 1024 * 1024;

export function publicUrl(value) {
  if (typeof value !== 'string' || value.length > 4096 || /[\x00-\x20\\]/.test(value)) throw new Error('Invalid URL');
  const url = new URL(value);
  const host = url.hostname;
  // Reject literals altogether, including WHATWG-normalized hex/octal IPv4 and IPv6.
  if (url.protocol !== 'https:' || url.port || url.username || url.password ||
      host.includes(':') || /^[\d.]+$/.test(host) || host.endsWith('.') ||
      !host.includes('.') || !/^[a-z0-9.-]+$/.test(host) ||
      host.split('.').some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
      /\.(?:localhost|local|internal|test|invalid|example|onion)$/.test(host)) throw new Error('Public HTTPS URL required');
  url.hash = '';
  return url;
}

export function siteUrl(value) {
  if (typeof value !== 'string') throw new Error('Invalid URL');
  return publicUrl(value.includes('://') ? value : `https://${value}`).href;
}

export function isPublicAddress(address) {
  if (typeof address !== 'string') return false;
  if (address.includes(':')) {
    // Only native global unicast 2000::/3; reject transition/translation mechanisms.
    if (!/^[0-9a-f:]+$/i.test(address) || !/^[23][0-9a-f]{3}:/i.test(address)) return false;
    const first = address.split(':').slice(0, 3).map(part => parseInt(part || '0', 16));
    if (first[0] === 0x2001 && (first[1] < 0x200 || first[1] === 0xdb8)) return false;
    return first[0] !== 0x2002 && !(first[0] === 0x3fff && first[1] < 0x1000);
  }
  const parts = address.split('.');
  if (parts.length !== 4 || parts.some(p => !/^\d{1,3}$/.test(p) || +p > 255)) return false;
  const [a, b, c] = parts.map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 2))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113));
}

export async function readLimited(response, limit, signal) {
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel();
    throw new Error('Response too large');
  }
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  let size = 0;
  const chunks = [];
  const abort = () => { reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      if (signal?.aborted) throw new Error('Request timed out');
      const { done, value } = await reader.read();
      if (signal?.aborted) throw new Error('Request timed out');
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error('Response too large');
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  } finally {
    signal?.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

// Fixed service destinations must never inherit redirects or send credentials elsewhere.
export async function serviceFetch(value, options = {}, { hosts, limit = 1024 * 1024, mime = /^(?:application\/(?:json|[\w.+-]+\+json)|text\/plain|application\/x-pem-file)$/i, timeout = 8000 } = {}) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !hosts?.includes(url.hostname)) throw new Error('Untrusted service URL');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url.href, { ...options, redirect: 'manual', signal: controller.signal });
    if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); throw new Error('Service redirect refused'); }
    if (response.status === 204) return new Response(null, { status: 204 });
    const type = (response.headers.get('content-type') || '').split(';')[0].trim();
    if (!mime.test(type)) { await response.body?.cancel(); throw new Error('Unexpected response type'); }
    return new Response(await readLimited(response, limit, controller.signal), { status: response.status, headers: response.headers });
  } finally { clearTimeout(timer); }
}

export async function dnsQuery(host, type, signal) {
  const response = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`, {
    headers: { Accept: 'application/dns-json' }, redirect: 'error', signal,
  });
  if (!response.ok || !/application\/(?:dns-)?json/i.test(response.headers.get('content-type') || '')) throw new Error('DNS unavailable');
  return JSON.parse(new TextDecoder().decode(await readLimited(response, 32768, signal)));
}

export async function assertPublicHost(host, signal) {
  const replies = await Promise.all([dnsQuery(host, 'A', signal), dnsQuery(host, 'AAAA', signal)]);
  if (replies.some(reply => ![0, 3].includes(reply.Status))) throw new Error('DNS unavailable');
  const answers = replies.flatMap(reply => reply.Answer || []);
  const addresses = answers.filter(answer => [1, 28].includes(answer.type));
  if (!addresses.length || addresses.some(answer => !isPublicAddress(answer.data))) throw new Error('Non-public destination');
  for (const alias of answers.filter(answer => answer.type === 5)) publicUrl(`https://${alias.data.replace(/\.$/, '')}/`);
}

export async function crawlFetch(value, { method = 'GET', headers = {}, body = true, timeout = 10000 } = {}) {
  let url = publicUrl(value);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    for (let redirectCount = 0; redirectCount <= 8; redirectCount++) {
      // No DNS cache for crawler destinations. Recheck every hop and every request.
      const dnsTimer = setTimeout(() => controller.abort(), 2000);
      try { await assertPublicHost(url.hostname, controller.signal); } finally { clearTimeout(dnsTimer); }
      const response = await fetch(url.href, { method, headers, redirect: 'manual', signal: controller.signal });
      const location = response.headers.get('location');
      if ([301, 302, 303, 307, 308].includes(response.status) && location) {
        await response.body?.cancel();
        url = publicUrl(new URL(location, url).href);
        continue;
      }
      if (!body || method === 'HEAD') {
        await response.body?.cancel();
        return { response: new Response(null, { status: response.status, headers: response.headers }), finalUrl: url.href, redirectCount };
      }
      const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!['text/html', 'application/xhtml+xml'].includes(type)) {
        await response.body?.cancel();
        return { response: new Response(null, { status: response.status, headers: response.headers }), finalUrl: url.href, redirectCount };
      }
      const bytes = await readLimited(response, HTML_LIMIT, controller.signal);
      const responseHeaders = new Headers(response.headers);
      responseHeaders.delete('content-encoding');
      responseHeaders.delete('content-length');
      return { response: new Response(bytes, { status: response.status, headers: responseHeaders }), finalUrl: url.href, redirectCount };
    }
    throw new Error('Too many redirects');
  } finally { clearTimeout(timer); }
}

export function opaqueId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9-]{1,80}$/.test(value)) throw new Error('Invalid service identifier');
  return value;
}
