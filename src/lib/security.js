export function relativeRedirect(value, fallback = '/account') {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\\\x00-\x20%]/.test(value)) return fallback;
  return value;
}

export function scriptJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}
