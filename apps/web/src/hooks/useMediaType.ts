import { useCallback } from 'react';
import { useSearchParams } from 'react-router';
import { LIBRARY_MEDIA_TYPES, type LibraryMediaType, type MediaTypeOption } from '@tracearr/shared';

export type MediaTypeOptions<T extends MediaTypeOption = MediaTypeOption> = readonly [T, ...T[]];

/** Quality has no music series, and can show every type at once. */
export const QUALITY_MEDIA_TYPES = ['all', 'movie', 'show'] as const satisfies MediaTypeOptions;

interface MediaTypeState<T extends MediaTypeOption> {
  value: T;
  // Method syntax so the narrower overloads stay assignable to the implementation.
  setValue(this: void, next: T): void;
}

/** Browse links used the plural before the type param was shared across pages. */
const LEGACY_TYPES: Partial<Record<string, MediaTypeOption>> = { shows: 'show', movies: 'movie' };

export function useMediaType(): MediaTypeState<LibraryMediaType>;
export function useMediaType<T extends MediaTypeOption>(
  options: MediaTypeOptions<T>,
  fallback?: T
): MediaTypeState<T>;
export function useMediaType(
  options: MediaTypeOptions = LIBRARY_MEDIA_TYPES,
  fallback: MediaTypeOption = options[0]
): MediaTypeState<MediaTypeOption> {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get('type') ?? '';
  const read = LEGACY_TYPES[raw] ?? raw;
  const value = options.find((type) => type === read) ?? fallback;

  const setValue = useCallback(
    (next: MediaTypeOption) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          params.set('type', next);
          return params;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  return { value, setValue };
}
