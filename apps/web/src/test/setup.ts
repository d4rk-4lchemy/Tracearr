import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// jsdom doesn't implement ResizeObserver or scrollIntoView, both of which
// cmdk (Command) relies on for its list sizing and keyboard navigation.
// Only components using cmdk-based pickers need these.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {
      // no-op: jsdom has no layout, so there's nothing to observe
    }
    unobserve() {
      // no-op
    }
    disconnect() {
      // no-op
    }
  };
}
if (typeof Element.prototype.scrollIntoView === 'undefined') {
  Element.prototype.scrollIntoView = () => {
    // no-op: jsdom has no layout, so there's nothing to scroll
  };
}

// jsdom has no Pointer Events implementation; radix Select's pointer-down
// handling calls these directly, so any test that opens a Select throws
// without them.
if (typeof Element.prototype.hasPointerCapture === 'undefined') {
  Element.prototype.hasPointerCapture = () => false;
}
if (typeof Element.prototype.setPointerCapture === 'undefined') {
  Element.prototype.setPointerCapture = () => {
    // no-op
  };
}
if (typeof Element.prototype.releasePointerCapture === 'undefined') {
  Element.prototype.releasePointerCapture = () => {
    // no-op
  };
}

// Highcharts checks this browser API while applying its adaptive theme. jsdom
// exposes CSS without `supports`, so real Highcharts component tests need the
// same harmless feature-detection fallback as an older browser.
if (typeof globalThis.CSS?.supports !== 'function') {
  Object.defineProperty(globalThis.CSS, 'supports', {
    configurable: true,
    value: () => false,
  });
}

afterEach(() => {
  cleanup();
});
