import type { LibraryMediaType } from '@tracearr/shared';

/** Link into Media > Browse with filters preset; Grid reads these on arrival (see linkedFilters). */
export function browseHref(
  type: LibraryMediaType,
  filters: Record<string, string | null | undefined>
): string {
  const params = new URLSearchParams();
  if (type !== 'movie') params.set('type', type);
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  return `/media/browse?${params.toString()}`;
}
