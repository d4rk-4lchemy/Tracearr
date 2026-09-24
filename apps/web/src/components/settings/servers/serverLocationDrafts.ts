import type { ServerLocationEntry } from '@tracearr/shared';

export interface LocationDraft {
  key: string;
  /** yyyy-mm-dd in the browser's timezone; null applies from the beginning */
  date: string | null;
  lat: string;
  lon: string;
  country: string;
  city: string;
  region: string;
}

let nextKey = 0;

export function emptyDraft(date: string | null): LocationDraft {
  nextKey += 1;
  return { key: `location-${nextKey}`, date, lat: '', lon: '', country: '', city: '', region: '' };
}

/** Local midnight of the picked day: a move applies from the start of that day where the owner is. */
export function effectiveFromOf(date: string): string {
  return new Date(`${date}T00:00:00`).toISOString();
}

function dateOf(effectiveFrom: string): string {
  const d = new Date(effectiveFrom);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayString(): string {
  return dateOf(new Date().toISOString());
}

/** Coordinates are stored as float4; six decimals is about 10 cm. */
export function coordinate(value: number): string {
  return String(Math.round(value * 1e6) / 1e6);
}

export function toDrafts(entries: ServerLocationEntry[]): LocationDraft[] {
  return entries.map((entry) => ({
    ...emptyDraft(entry.effectiveFrom ? dateOf(entry.effectiveFrom) : null),
    lat: coordinate(entry.lat),
    lon: coordinate(entry.lon),
    country: entry.country,
    city: entry.city ?? '',
    region: entry.region ?? '',
  }));
}

export function toEntries(drafts: LocationDraft[]): ServerLocationEntry[] | null {
  const entries: ServerLocationEntry[] = [];
  for (const draft of drafts) {
    const lat = Number(draft.lat);
    const lon = Number(draft.lon);
    if (
      draft.lat.trim() === '' ||
      draft.lon.trim() === '' ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      Math.abs(lat) > 90 ||
      Math.abs(lon) > 180 ||
      !/^[A-Z]{2}$/.test(draft.country) ||
      (draft.date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(draft.date))
    ) {
      return null;
    }
    entries.push({
      effectiveFrom: draft.date === null ? null : effectiveFromOf(draft.date),
      lat,
      lon,
      city: draft.city.trim() || null,
      region: draft.region.trim() || null,
      country: draft.country,
    });
  }
  return entries;
}

export function draftsKey(drafts: LocationDraft[]): string {
  return JSON.stringify(drafts.map(({ key: _, ...rest }) => rest));
}
