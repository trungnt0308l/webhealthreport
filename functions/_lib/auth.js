/**
 * Auth0 JWT verification middleware for Cloudflare Workers.
 * Uses RS256 asymmetric verification — no secret needed, only Auth0's public JWKS keys.
 */

// Module-level JWKS cache (lives for the lifetime of a Worker instance)
let jwksCache = null;
let jwksCacheTime = 0;
const JWKS_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Fetch and cache Auth0's public JWKS keys.
 */
async function getJwks(env) {
  const now = Date.now();
  if (jwksCache && now - jwksCacheTime < JWKS_TTL_MS) {
    return jwksCache;
  }
  const res = await fetch(`https://${env.AUTH0_DOMAIN}/.well-known/jwks.json`);
  if (!res.ok) throw new Error('Failed to fetch JWKS');
  jwksCache = await res.json();
  jwksCacheTime = now;
  return jwksCache;
}

/**
 * Base64url decode to Uint8Array.
 */
function base64urlDecode(str) {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + (4 - (base64.length % 4)) % 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

/**
 * Convert a JWK (RSA public key) to a CryptoKey for RS256 verification.
 */
async function importRsaPublicKey(jwk) {
  return crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );
}

/**
 * Verify an Auth0-issued RS256 JWT.
 * Returns the decoded payload { sub, email, name, ... } or throws on failure.
 */
export async function verifyAuth0JWT(token, env) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT format');

  const [headerB64, payloadB64, signatureB64] = parts;

  // Decode header to get kid
  let header;
  try {
    header = JSON.parse(new TextDecoder().decode(base64urlDecode(headerB64)));
  } catch {
    throw new Error('Invalid JWT header');
  }
  if (header.alg !== 'RS256') throw new Error('Expected RS256 algorithm');

  // Find matching key in JWKS
  const jwks = await getJwks(env);
  const jwk = jwks.keys?.find(k => k.kid === header.kid && k.use === 'sig');
  if (!jwk) throw new Error('No matching JWKS key found');

  // Verify signature
  const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = base64urlDecode(signatureB64);
  const cryptoKey = await importRsaPublicKey(jwk);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, signature, signingInput);
  if (!valid) throw new Error('JWT signature invalid');

  // Decode and validate payload claims
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64urlDecode(payloadB64)));
  } catch {
    throw new Error('Invalid JWT payload');
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) throw new Error('JWT expired');
  if (payload.iss !== `https://${env.AUTH0_DOMAIN}/`) throw new Error('JWT issuer mismatch');

  // aud can be a string or array
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(env.AUTH0_AUDIENCE)) throw new Error('JWT audience mismatch');

  return payload;
}

/**
 * Middleware that requires a valid Auth0 Bearer token.
 * Injects ctx.data.user = { id, email, name } and calls the handler.
 * Returns 401 JSON if missing or invalid.
 */
export function requireAuth(handler) {
  return async (ctx) => {
    const { request, env } = ctx;
    const authHeader = request.headers.get('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
      return json({ error: 'Authentication required' }, 401);
    }

    let payload;
    try {
      payload = await verifyAuth0JWT(token, env);
    } catch (err) {
      return json({ error: 'Invalid or expired token' }, 401);
    }

    ctx.data.user = {
      id: payload.sub,
      email: payload.email || payload['https://webhealthreport/email'] || '',
      name: payload.name || payload['https://webhealthreport/name'] || '',
    };

    return handler(ctx);
  };
}

/**
 * Shared JSON response helper.
 */
export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
