window.onloadTurnstileCallback = function () {
  if (window._pendingTurnstileRender) window._pendingTurnstileRender();
  window.dispatchEvent(new Event('turnstile-ready'));
};
