import { dnsQuery, isPublicAddress, publicUrl } from './network.js';

const cache = new Map();
export async function validMailDomain(email) {
  if (typeof email !== 'string' || email.length > 254) return false;
  const domain = email.slice(email.lastIndexOf('@') + 1).toLowerCase();
  try { publicUrl(`https://${domain}/`); } catch { return false; }
  const cached = cache.get(domain);
  if (cached && cached.expires > Date.now()) return cached.valid;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  try {
    const mx = await dnsQuery(domain, 'MX', controller.signal);
    if (![0, 3].includes(mx.Status)) throw new Error('Mail DNS unavailable');
    const records = (mx.Answer || []).filter(answer => answer.type === 15);
    let valid = false;
    if (mx.Status === 0 && records.length) {
      valid = records.every(record => {
        const parts = record.data.trim().split(/\s+/);
        if (parts.length !== 2 || !/^\d+$/.test(parts[0]) || parts[1] === '.') return false;
        try { publicUrl(`https://${parts[1].replace(/\.$/, '')}/`); return true; } catch { return false; }
      });
    } else if (mx.Status === 0) {
      const a = await dnsQuery(domain, 'A', controller.signal);
      if (![0, 3].includes(a.Status)) throw new Error('Mail DNS unavailable');
      const addresses = (a.Answer || []).filter(answer => answer.type === 1);
      valid = a.Status === 0 && addresses.length > 0 && addresses.every(answer => isPublicAddress(answer.data));
    }
    if (cache.size >= 256) cache.clear();
    cache.set(domain, { valid, expires: Date.now() + 60000 });
    return valid;
  } finally { clearTimeout(timer); }
}
