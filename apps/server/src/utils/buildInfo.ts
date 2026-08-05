import { readFileSync, existsSync } from 'node:fs';

interface BuildInfo {
  version: string;
  tag: string | null;
  commit: string | null;
  buildDate: string | null;
  upstreamVersion: string;
  forkRevision: number | null;
  forkVersion: string | null;
  forkReleaseTag: string | null;
  forkRepo: string;
  imageRepo: string;
}

const BUILD_INFO_PATH = '/app/.build-info.json';

function loadBuildInfo(): BuildInfo {
  if (existsSync(BUILD_INFO_PATH)) {
    try {
      const content = readFileSync(BUILD_INFO_PATH, 'utf-8');
      const parsed = JSON.parse(content) as Record<string, string>;
      return {
        version: parsed.version || '0.0.0',
        tag: parsed.tag || null,
        commit: parsed.commit || null,
        buildDate: parsed.buildDate || null,
        upstreamVersion: parsed.upstreamVersion || parsed.version || '0.0.0',
        forkRevision: parsed.forkRevision ? Number(parsed.forkRevision) : null,
        forkVersion: parsed.forkVersion || null,
        forkReleaseTag: parsed.forkReleaseTag || null,
        forkRepo: parsed.forkRepo || 'd4rk-4lchemy/Tracearr',
        imageRepo: parsed.imageRepo || 'darkalchemy2137/distracearr',
      };
    } catch {
      // Fall through to ENV fallback
    }
  }

  return {
    version: process.env.APP_VERSION ?? '0.0.0',
    tag: process.env.APP_TAG ?? null,
    commit: process.env.APP_COMMIT ?? null,
    buildDate: process.env.APP_BUILD_DATE ?? null,
    upstreamVersion: process.env.APP_UPSTREAM_VERSION ?? process.env.APP_VERSION ?? '0.0.0',
    forkRevision: process.env.APP_FORK_REVISION ? Number(process.env.APP_FORK_REVISION) : null,
    forkVersion: process.env.APP_FORK_VERSION ?? null,
    forkReleaseTag: process.env.APP_FORK_RELEASE_TAG ?? null,
    forkRepo: process.env.APP_FORK_REPO ?? 'd4rk-4lchemy/Tracearr',
    imageRepo: process.env.APP_IMAGE_REPO ?? 'darkalchemy2137/distracearr',
  };
}

const buildInfo = loadBuildInfo();

export function getCurrentVersion(): string {
  return buildInfo.version;
}

export function getCurrentTag(): string | null {
  return buildInfo.tag;
}

export function getCurrentCommit(): string | null {
  return buildInfo.commit;
}

export function getBuildDate(): string | null {
  return buildInfo.buildDate;
}

export function getBuildInfo(): BuildInfo {
  return { ...buildInfo };
}
