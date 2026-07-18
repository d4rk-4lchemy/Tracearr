// Removed is per-account. A person only counts as removed once every account is gone.

export interface RemovableAccount {
  removedAt: string | Date | null;
}

export type PersonRemovedState = { removed: true; removedAt: string | Date } | { removed: false };

export function getPersonRemovedState(
  serverUsers: RemovableAccount[] | undefined
): PersonRemovedState {
  if (!serverUsers || serverUsers.length === 0) {
    return { removed: false };
  }

  const removedDates = serverUsers
    .map((account) => account.removedAt)
    .filter((removedAt): removedAt is string | Date => removedAt != null);
  if (removedDates.length !== serverUsers.length) {
    return { removed: false };
  }

  const [firstRemovedAt, ...otherRemovedDates] = removedDates;
  if (firstRemovedAt === undefined) {
    return { removed: false };
  }

  const latest = otherRemovedDates.reduce<string | Date>(
    (latest, removedAt) => (new Date(removedAt) > new Date(latest) ? removedAt : latest),
    firstRemovedAt
  );

  return { removed: true, removedAt: latest };
}
