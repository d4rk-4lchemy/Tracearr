const RANGE_KEYS = ['period', 'from', 'to', 'type'] as const;

export function withRangeParams(href: string, search: string): string {
  const source = new URLSearchParams(search);
  const [path = href, existing = ''] = href.split('?');
  const params = new URLSearchParams(existing);

  for (const key of RANGE_KEYS) {
    const value = source.get(key);
    if (value !== null) params.set(key, value);
  }

  const query = params.toString();
  return query ? `${path}?${query}` : path;
}
