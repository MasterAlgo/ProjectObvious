/* Shared progressive enhancements. No network or framework dependency. */
(() => {
  document.querySelectorAll('input[id], select[id]').forEach(input => {
    if (!input.labels?.length && !input.hasAttribute('aria-label')) {
      const label = input.closest('.ctrl-group')?.querySelector('label');
      if (label) { label.htmlFor = input.id; }
    }
  });
  document.querySelectorAll('iframe').forEach(frame => {
    frame.addEventListener('load', () => { frame.dataset.loaded = 'true'; });
  });
  if (window.parent !== window && location.pathname.includes('/labs/')) {
    document.documentElement.classList.add('embedded-lab');
    // Measure intrinsic body content, not the iframe viewport (which would
    // create a resize feedback loop when the parent changes frame height).
    const report = () => {
      const style = getComputedStyle(document.body);
      const margins = (parseFloat(style.marginTop) || 0) + (parseFloat(style.marginBottom) || 0);
      parent.postMessage({ obviousC8: 'resize', height: Math.ceil(document.body.getBoundingClientRect().height + margins + 8) }, '*');
    };
    addEventListener('load', report); addEventListener('resize', report);
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(report).observe(document.body);
    report();
  }
})();
