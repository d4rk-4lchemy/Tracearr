/**
 * Warm concurrency tiering - how hard a background precache pass is allowed
 * to push while people are watching, and how it backs off when the upstream
 * starts failing.
 */

import { describe, it, expect } from 'vitest';
import {
  streamPressure,
  warmConcurrencyFor,
  backoffDelayMs,
  WARM_CONCURRENCY_IDLE,
  WARM_CONCURRENCY_LIGHT,
  WARM_CONCURRENCY_HEAVY,
  FAILURE_BACKOFF_BASE_MS,
  FAILURE_BACKOFF_MAX_MS,
} from '../warmConcurrency.js';

describe('streamPressure', () => {
  it('scores an idle server at zero', () => {
    expect(streamPressure([])).toBe(0);
  });

  it('counts a direct play as one', () => {
    expect(streamPressure([{ isTranscode: false }, { isTranscode: false }])).toBe(2);
  });

  it('weights a transcode above a direct play, since both contend for the same CPU', () => {
    expect(streamPressure([{ isTranscode: true }])).toBe(4);
    expect(streamPressure([{ isTranscode: true }, { isTranscode: false }])).toBe(5);
  });
});

describe('warmConcurrencyFor', () => {
  it('runs at full speed on an idle server', () => {
    expect(warmConcurrencyFor(0)).toBe(WARM_CONCURRENCY_IDLE);
  });

  it('eases off under light load', () => {
    expect(warmConcurrencyFor(1)).toBe(WARM_CONCURRENCY_LIGHT);
    expect(warmConcurrencyFor(4)).toBe(WARM_CONCURRENCY_LIGHT);
  });

  it('drops to the floor above light load', () => {
    expect(warmConcurrencyFor(5)).toBe(WARM_CONCURRENCY_HEAVY);
    expect(warmConcurrencyFor(50)).toBe(WARM_CONCURRENCY_HEAVY);
  });

  it('never returns zero, so a permanently busy server still converges', () => {
    for (const pressure of [0, 1, 4, 5, 9, 100]) {
      expect(warmConcurrencyFor(pressure)).toBeGreaterThan(0);
    }
  });

  it('leaves headroom under the six-slot fetch semaphore for live browsing', () => {
    expect(WARM_CONCURRENCY_IDLE).toBeLessThan(6);
  });
});

describe('backoffDelayMs', () => {
  it('starts at the base delay and doubles', () => {
    expect(backoffDelayMs(0)).toBe(FAILURE_BACKOFF_BASE_MS);
    expect(backoffDelayMs(1)).toBe(FAILURE_BACKOFF_BASE_MS * 2);
    expect(backoffDelayMs(2)).toBe(FAILURE_BACKOFF_BASE_MS * 4);
  });

  it('caps so a long outage cannot push the retry out by days', () => {
    expect(backoffDelayMs(99)).toBe(FAILURE_BACKOFF_MAX_MS);
  });
});
