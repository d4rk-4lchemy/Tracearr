/**
 * Channels DVR system stats from the undocumented `GET /system` document.
 *
 * It reports memory, load averages and a per-core CPU list, but no CPU
 * utilization and no process CPU. Host CPU is therefore estimated from the
 * 1-minute load average divided by the logical core count (capped at 100), which
 * is a load figure rather than true utilization. Process CPU is left null so the
 * chart omits that line instead of drawing a made-up one.
 */

import { fetchJson } from '../../../utils/http.js';

export interface ChannelsDvrStatsSample {
  at: number;
  hostCpuUtilization: number | null;
  processCpuUtilization: number | null;
  hostMemoryUtilization: number | null;
  processMemoryUtilization: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function percent(value: number | null): number | null {
  if (value === null) return null;
  return Math.round(Math.min(100, Math.max(0, value)) * 10) / 10;
}

export function parseSystemStats(
  data: unknown,
  now: number = Date.now()
): ChannelsDvrStatsSample | null {
  if (!isRecord(data)) return null;

  const cores = Array.isArray(data.cpu) ? data.cpu.length : 0;
  const load1 = isRecord(data.load) ? finite(data.load.load1) : null;
  const hostCpu = cores > 0 && load1 !== null ? percent((load1 / cores) * 100) : null;

  let hostMemory: number | null = null;
  if (isRecord(data.memory)) {
    hostMemory = finite(data.memory.usedPercent);
    if (hostMemory === null) {
      const total = finite(data.memory.total);
      const available = finite(data.memory.available);
      if (total !== null && total > 0 && available !== null) {
        hostMemory = (1 - available / total) * 100;
      }
    }
  }

  const processMemory = isRecord(data.process) ? finite(data.process.memoryPercent) : null;

  if (hostMemory === null && processMemory === null) return null;

  return {
    at: now,
    hostCpuUtilization: hostCpu,
    processCpuUtilization: null,
    hostMemoryUtilization: percent(hostMemory),
    processMemoryUtilization: percent(processMemory),
  };
}

/** Fetch and parse `GET /system`; null if the document has no memory figures. */
export async function fetchSystemStats(baseUrl: string): Promise<ChannelsDvrStatsSample | null> {
  const data = await fetchJson<unknown>(`${baseUrl.replace(/\/+$/, '')}/system`, {
    headers: { Accept: 'application/json' },
    service: 'channels-dvr',
    timeout: 10000,
  });
  return parseSystemStats(data);
}
