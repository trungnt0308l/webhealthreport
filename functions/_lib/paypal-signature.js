import { X509Certificate } from 'node:crypto';
import { serviceFetch } from './network.js';

const certificates = new Map();

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// PayPal signs transmissionId|time|webhookId|crc32(original raw request bytes).
// Use the cryptographic verifier's comparison, never compare signature strings.
export async function verifyPaypalSignature(env, request, bytes) {
  const get = name => request.headers.get(`paypal-${name}`);
  const id = get('transmission-id'), time = get('transmission-time'), signature = get('transmission-sig');
  if (!env.PAYPAL_WEBHOOK_ID || get('auth-algo') !== 'SHA256withRSA' ||
      !/^[a-zA-Z0-9-]{1,200}$/.test(id || '') || !/^[a-zA-Z0-9+/]{40,2048}={0,2}$/.test(signature || '') ||
      !time || !Number.isFinite(Date.parse(time)) || Date.parse(time) > Date.now() + 300000 || Date.parse(time) < Date.now() - 3 * 86400000) return false;
  let certUrl;
  try { certUrl = new URL(get('cert-url')); } catch { return false; }
  const hosts = ['api.paypal.com', 'api.sandbox.paypal.com'];
  if (!hosts.includes(certUrl.hostname) || certUrl.protocol !== 'https:' || certUrl.username || certUrl.password || certUrl.port || certUrl.search || certUrl.hash ||
      !/^\/v1\/notifications\/certs\/CERT-[a-zA-Z0-9-]+$/.test(certUrl.pathname)) return false;
  let cached = certificates.get(certUrl.href);
  if (!cached || cached.expires < Date.now()) {
    const response = await serviceFetch(certUrl.href, {}, { hosts, limit: 16384, mime: /^(?:application\/x-pem-file|text\/plain|application\/octet-stream)$/i });
    if (!response.ok) throw new Error('Certificate service unavailable');
    cached = { certificate: new X509Certificate(await response.text()), expires: Date.now() + 300000 };
    if (certificates.size >= 8) certificates.clear();
    certificates.set(certUrl.href, cached);
  }
  const cert = cached.certificate;
  if (Date.parse(cert.validFrom) > Date.now() || Date.parse(cert.validTo) < Date.now()) return false;
  const publicKey = await crypto.subtle.importKey('spki', cert.publicKey.export({ type: 'spki', format: 'der' }),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  return crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, Buffer.from(signature, 'base64'),
    new TextEncoder().encode(`${id}|${time}|${env.PAYPAL_WEBHOOK_ID}|${crc32(bytes)}`));
}
