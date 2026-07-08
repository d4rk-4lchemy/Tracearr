/**
 * Pure helpers for the Users page bulk merge action.
 */

interface MergeSelectableRow {
  userId: string;
}

export type MergeDisableReasonKey =
  | 'pages:users.mergeSelectAllActive'
  | 'pages:users.mergeSelectTwo'
  | 'pages:users.mergeSameIdentity';

export interface MergeActionState {
  disabled: boolean;
  reasonKey?: MergeDisableReasonKey;
}

export function deriveMergeActionState(
  selectedRows: MergeSelectableRow[],
  selectAllMode: boolean,
  selectedCount: number
): MergeActionState {
  if (selectAllMode) {
    return { disabled: true, reasonKey: 'pages:users.mergeSelectAllActive' };
  }
  if (selectedCount !== 2) {
    return { disabled: true, reasonKey: 'pages:users.mergeSelectTwo' };
  }
  const [first, second] = selectedRows;
  if (selectedRows.length === 2 && first?.userId === second?.userId) {
    return { disabled: true, reasonKey: 'pages:users.mergeSameIdentity' };
  }
  return { disabled: false };
}

interface ServerUserOverlapCandidate {
  serverId: string;
  serverName: string;
}

export function findOverlappingServerName(
  first: ServerUserOverlapCandidate[],
  second: ServerUserOverlapCandidate[]
): string | null {
  const overlap = first.find((su) => second.some((other) => other.serverId === su.serverId));
  return overlap?.serverName ?? null;
}
