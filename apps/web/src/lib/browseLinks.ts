/** Link into Media > Browse with filters preset; Grid reads these on arrival (see linkedFilters). */
export function browseHref(
  type: 'movie' | 'show',
  filters: Record<string, string | null | undefined>
): string {
  const params = new URLSearchParams();
  if (type === 'show') params.set('type', 'shows');
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  return `/media/browse?${params.toString()}`;
}
