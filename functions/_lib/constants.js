/**
 * Shared constants for API endpoint functions.
 */

/**
 * Basic email format validation regex.
 * Matches: local-part @ domain . tld (tld must be 2+ chars)
 */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Generate a compact 16-char hex ID from a UUID.
 * Suitable for use as a database primary key.
 */
export function generateId() {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}
