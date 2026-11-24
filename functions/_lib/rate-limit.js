export async function rateLimit(request, env, bucket, maximum, seconds = 60) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
  const key = `${bucket}:${Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('')}`;
  const now = Math.floor(Date.now() / 1000);
  const start = now - now % seconds;
  const result = await env.DB.prepare(`INSERT INTO request_limits (key, window_start, count) VALUES (?, ?, 1)
    ON CONFLICT(key) DO UPDATE SET
      count = CASE WHEN window_start = excluded.window_start THEN count + 1 ELSE 1 END,
      window_start = excluded.window_start
    RETURNING count`).bind(key, start).first();
  return result.count <= maximum;
}
