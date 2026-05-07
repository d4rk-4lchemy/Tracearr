import { registerService, unregisterService } from '../services/serviceTracker.js';
import { sseManager } from '../services/sseManager.js';
import { triggerPoll } from './poller/index.js';

let isRunning = false;
const debounceTimers = new Map<string, NodeJS.Timeout>();
const DEBOUNCE_MS = 250;

const wrappedHandlers = {
  snapshot: ({ serverId }: { serverId: string; sessions: unknown[] }) => {
    const existing = debounceTimers.get(serverId);
    if (existing) clearTimeout(existing);
    debounceTimers.set(
      serverId,
      setTimeout(() => {
        debounceTimers.delete(serverId);
        void triggerPoll();
      }, DEBOUNCE_MS)
    );
  },
};

export function startDispatcharrRealtimeProcessor(): void {
  if (isRunning) return;
  isRunning = true;
  registerService('dispatcharr-realtime-processor', {
    name: 'Dispatcharr Realtime Processor',
    description: 'Processes Dispatcharr WS snapshots via poller lifecycle pipeline',
    intervalMs: 0,
  });

  sseManager.on('dispatcharr:snapshot', wrappedHandlers.snapshot);
}

export function stopDispatcharrRealtimeProcessor(): void {
  if (!isRunning) return;
  isRunning = false;
  unregisterService('dispatcharr-realtime-processor');
  sseManager.off('dispatcharr:snapshot', wrappedHandlers.snapshot);
  for (const timer of debounceTimers.values()) clearTimeout(timer);
  debounceTimers.clear();
}
