import { fetchJson } from '../utils/http.js';
import { maxVersion, compareVersions, parseDottedVersion } from '../utils/pluginVersion.js';
import type { PluginFamily } from '@tracearr/shared';
import { startPeriodic, type PeriodicTimers } from '../utils/periodic.js';
import { sseManager } from '../services/sseManager.js';
import { getSettings } from '../services/settings.js';
import { dispatchPluginUpdate } from '../services/automations/events/producers.js';
import { db } from '../db/client.js';
import { servers } from '../db/schema.js';

const DEFAULT_MANIFEST_URL =
  'https://raw.githubusercontent.com/Tracearr/Media-Server-SSE/main/manifest.json';
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const INITIAL_DELAY_MS = 15_000;
const RELEASES_URL = 'https://github.com/Tracearr/Media-Server-SSE/releases/latest';
const DISPATCHARR_RELEASE_API_URL =
  'https://api.github.com/repos/d4rk-4lchemy/Tracearr-SSE-Metrics/releases/latest';
const DISPATCHARR_RELEASES_URL = 'https://github.com/d4rk-4lchemy/Tracearr-SSE-Metrics/releases/latest';

interface ManifestEntry {
  versions?: { version?: string }[];
}

interface GitHubRelease {
  tag_name?: string;
  html_url?: string;
  draft?: boolean;
  prerelease?: boolean;
}

interface PluginUpdateTarget {
  family: PluginFamily;
  latest: string;
  downloadUrl: string;
}

let timers: PeriodicTimers | null = null;
// serverId -> family/latest version already nudged for; re-arms when latest changes
const nudgedVersions = new Map<string, string>();

export function _resetNudgeStateForTests(): void {
  nudgedVersions.clear();
}

export async function runPluginUpdateCheck(): Promise<void> {
  try {
    const settings = await getSettings(['pluginUpdateCheckEnabled', 'pluginManifestUrl']);
    if (!settings.pluginUpdateCheckEnabled) return;

    const targets: PluginUpdateTarget[] = [];
    const manifestUrl = settings.pluginManifestUrl ?? DEFAULT_MANIFEST_URL;
    const [manifestResult, dispatcharrResult] = await Promise.allSettled([
      fetchJson<ManifestEntry[]>(manifestUrl, { timeout: 10_000, service: 'github' }),
      fetchJson<GitHubRelease>(DISPATCHARR_RELEASE_API_URL, {
        timeout: 10_000,
        service: 'github',
      }),
    ]);

    if (manifestResult.status === 'fulfilled') {
      const allVersions = (Array.isArray(manifestResult.value) ? manifestResult.value : [])
        .flatMap((entry) => entry.versions ?? [])
        .map((v) => v.version)
        .filter((v): v is string => typeof v === 'string');
      const latest = maxVersion(allVersions);
      if (latest) {
        targets.push({
          family: 'media-server-sse',
          latest,
          downloadUrl: RELEASES_URL,
        });
        sseManager.setLatestPluginVersion('media-server-sse', latest);
      } else {
        console.warn('[PluginUpdate] No parseable versions in SSE manifest, skipping SSE check');
      }
    } else {
      console.warn('[PluginUpdate] SSE manifest fetch failed, skipping SSE check:', manifestResult.reason);
    }

    if (dispatcharrResult.status === 'fulfilled') {
      const release = dispatcharrResult.value;
      const normalizedTag =
        typeof release.tag_name === 'string' ? release.tag_name.replace(/^v/i, '') : null;
      const latest = normalizedTag && parseDottedVersion(normalizedTag) ? normalizedTag : null;
      if (latest && release.draft !== true && release.prerelease !== true) {
        targets.push({
          family: 'dispatcharr-metrics',
          latest,
          downloadUrl:
            typeof release.html_url === 'string' && release.html_url.length > 0
              ? release.html_url
              : DISPATCHARR_RELEASES_URL,
        });
        sseManager.setLatestPluginVersion('dispatcharr-metrics', latest);
      } else {
        console.warn('[PluginUpdate] No parseable stable Dispatcharr release, skipping check');
      }
    } else {
      console.warn(
        '[PluginUpdate] Dispatcharr release fetch failed, skipping Dispatcharr check:',
        dispatcharrResult.reason
      );
    }

    if (targets.length === 0) return;

    const allServers = await db.select().from(servers);
    for (const server of allServers) {
      if (server.type === 'plex') continue;
      if (sseManager.isInFallback(server.id)) continue;

      const family: PluginFamily =
        server.type === 'dispatcharr' ? 'dispatcharr-metrics' : 'media-server-sse';
      const target = targets.find((candidate) => candidate.family === family);
      if (!target) continue;

      const installed = sseManager.getPluginVersion(server.id);
      // A Dispatcharr plugin without a reported version is not enough evidence
      // to claim that an update exists. Its version announcement can arrive
      // shortly after the realtime connection is established.
      const outdated =
        installed !== null && compareVersions(installed, target.latest) < 0;
      const nudgeKey = `${family}:${target.latest}`;
      if (!outdated) {
        nudgedVersions.delete(server.id);
        continue;
      }
      if (nudgedVersions.get(server.id) === nudgeKey) continue;

      nudgedVersions.set(server.id, nudgeKey);
      await dispatchPluginUpdate({
        server: { id: server.id, name: server.name, type: server.type },
        installedVersion: installed,
        latestVersion: target.latest,
        downloadUrl: target.downloadUrl,
      });
      console.log(
        `[PluginUpdate] ${server.name}: plugin ${installed ?? 'pre-0.2.0'} -> ${target.latest} available`
      );
    }
  } catch (error) {
    console.error('[PluginUpdate] Check failed:', error);
  }
}

export function startPluginUpdateChecker(): void {
  if (timers) return;
  // The initial delay waits for SSE connections and their hello frames to land
  timers = startPeriodic(INITIAL_DELAY_MS, CHECK_INTERVAL_MS, runPluginUpdateCheck);
  console.log('[PluginUpdate] Checker started (every 6h)');
}

export function stopPluginUpdateChecker(): void {
  timers?.stop();
  timers = null;
}
