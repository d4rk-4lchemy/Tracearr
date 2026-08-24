/**
 * What a library sync announces: the items it inserted, and the ones whose quality
 * signature moved. The diff is pure so the sync can run it after its transaction
 * commits and dispatch whatever it finds.
 */

import {
  dispatchMediaAdded,
  dispatchMediaUpgraded,
  hasMediaListeners,
} from '../automations/events/producers.js';
import { MEDIA_QUALITY_FIELDS } from '../automations/types.js';
import type { EvaluationServer } from '../automations/events/types.js';
import type { MediaQuality, MediaSubject } from '../automations/types.js';

/** Items one sync run may announce before it goes quiet; a rebuilt library is not news. */
export const MEDIA_ANNOUNCE_CAP = 20;

/** Shared by every library of one sync run, so a whole-server rescan cannot flood. */
export interface MediaAnnounceBudget {
  remaining: number;
  suppressed: number;
}

/** The server being synced and the budget its libraries draw from. */
export interface MediaAnnounceRun {
  server: EvaluationServer;
  budget: MediaAnnounceBudget;
}

/** One library's announce context, as `upsertItems` receives it. */
export interface MediaAnnounce {
  server: EvaluationServer;
  libraryName: string;
  budget: MediaAnnounceBudget;
}

/** The quality a row held before the upsert, keyed by rating key. */
export interface PriorMediaRow {
  quality: MediaQuality;
}

/** A row the upsert changed, with the values it now holds. */
export interface SyncedMediaRow {
  id: string;
  ratingKey: string;
  firstSeenAt: Date | null;
  title: string;
  grandparentTitle: string | null;
  mediaType: string;
  year: number | null;
  quality: MediaQuality;
}

export type MediaChange =
  | { kind: 'added'; row: SyncedMediaRow }
  | { kind: 'upgraded'; row: SyncedMediaRow; from: MediaQuality; changed: (keyof MediaQuality)[] };

export function createAnnounceRun(server: EvaluationServer): MediaAnnounceRun {
  return { server, budget: { remaining: MEDIA_ANNOUNCE_CAP, suppressed: 0 } };
}

/**
 * The context for one library, or null when there is nothing to announce: a first
 * sync would announce the whole library, and no listener means no diff to pay for.
 */
export async function createMediaAnnounce(args: {
  run: MediaAnnounceRun;
  libraryName: string;
  isFirstSync: () => Promise<boolean>;
}): Promise<MediaAnnounce | null> {
  if (!(await hasMediaListeners(args.run.server.id))) return null;
  if (await args.isFirstSync()) return null;
  return { server: args.run.server, libraryName: args.libraryName, budget: args.run.budget };
}

/** A field counts only when both sides hold a value: a column arriving is not an upgrade. */
function changedFields(before: MediaQuality, after: MediaQuality): (keyof MediaQuality)[] {
  return MEDIA_QUALITY_FIELDS.filter(
    (field) => before[field] !== null && after[field] !== null && before[field] !== after[field]
  );
}

function changeOf(
  row: SyncedMediaRow,
  prior: PriorMediaRow | undefined,
  firstSeen: Date
): MediaChange | null {
  // first_seen_at is insert-only, so carrying this call's stamp is exactly a fresh insert.
  if (row.firstSeenAt?.getTime() === firstSeen.getTime()) return { kind: 'added', row };
  if (!prior) return null;
  const changed = changedFields(prior.quality, row.quality);
  if (changed.length === 0) return null;
  return { kind: 'upgraded', row, from: prior.quality, changed };
}

/** The changes worth announcing, capped at the budget the caller still holds. */
export function diffMediaChanges(args: {
  rows: readonly SyncedMediaRow[];
  prior: ReadonlyMap<string, PriorMediaRow>;
  firstSeen: Date;
  budget: number;
}): { changes: MediaChange[]; suppressed: number } {
  const changes: MediaChange[] = [];
  let suppressed = 0;

  for (const row of args.rows) {
    const change = changeOf(row, args.prior.get(row.ratingKey), args.firstSeen);
    if (!change) continue;
    if (changes.length >= args.budget) {
      suppressed += 1;
      continue;
    }
    changes.push(change);
  }

  return { changes, suppressed };
}

/** Runs after the upsert commits: one dispatch per changed item, and the budget spent. */
export async function announceMediaChanges(args: {
  announce: MediaAnnounce;
  libraryId: string;
  rows: readonly SyncedMediaRow[];
  prior: ReadonlyMap<string, PriorMediaRow>;
  firstSeen: Date;
}): Promise<void> {
  const { announce, libraryId, rows, prior, firstSeen } = args;
  const { changes, suppressed } = diffMediaChanges({
    rows,
    prior,
    firstSeen,
    budget: announce.budget.remaining,
  });
  announce.budget.remaining -= changes.length;
  announce.budget.suppressed += suppressed;

  for (const change of changes) {
    const media: MediaSubject = {
      libraryItemId: change.row.id,
      title: change.row.title,
      grandparentTitle: change.row.grandparentTitle,
      type: change.row.mediaType,
      year: change.row.year,
      libraryId,
      libraryName: announce.libraryName,
      quality: change.row.quality,
    };
    if (change.kind === 'added') {
      await dispatchMediaAdded({ server: announce.server, media });
    } else {
      await dispatchMediaUpgraded({
        server: announce.server,
        media,
        from: change.from,
        changed: change.changed,
      });
    }
  }
}
