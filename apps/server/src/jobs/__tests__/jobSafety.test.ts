import { describe, it, expect, vi } from 'vitest';
import type { Worker } from 'bullmq';
import { registerWorker, shutdownAllJobs } from '../jobSafety.js';

function fakeWorker(pause: () => Promise<void>) {
  let onClosed: () => void = () => {};
  const worker = {
    cancelAllJobs: vi.fn(),
    pause: vi.fn(pause),
    close: vi.fn(async () => onClosed()),
    once: vi.fn((_event: string, listener: () => void) => {
      onClosed = listener;
    }),
  };
  registerWorker(worker as unknown as Worker);
  return worker;
}

describe('shutdownAllJobs', () => {
  it('force-closes every worker even when one pause() rejects', async () => {
    const failing = fakeWorker(async () => {
      throw new Error('connection is closed');
    });
    const healthy = fakeWorker(async () => {});

    await shutdownAllJobs(1000);

    expect(failing.cancelAllJobs).toHaveBeenCalledWith('shutdown');
    expect(failing.close).toHaveBeenCalledWith(true);
    expect(healthy.close).toHaveBeenCalledWith(true);
  });
});
