import { createElement, type ReactNode } from 'react';
import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigationType } from 'react-router';
import type { MediaTypeOption } from '@tracearr/shared';
import { useMediaType, type MediaTypeOptions } from './useMediaType';

function setup(url: string, options?: MediaTypeOptions, fallback?: MediaTypeOption) {
  return renderHook(
    () => ({
      type: options ? useMediaType(options, fallback) : useMediaType(),
      location: useLocation(),
      action: useNavigationType(),
    }),
    {
      wrapper: ({ children }: { children: ReactNode }) =>
        createElement(MemoryRouter, { initialEntries: [url] }, children),
    }
  ).result;
}

describe('useMediaType', () => {
  it('defaults to movie', () => {
    expect(setup('/library/genres').current.type.value).toBe('movie');
  });

  it('falls back to movie for an unknown type', () => {
    expect(setup('/library/genres?type=album').current.type.value).toBe('movie');
    expect(setup('/library/genres?type=artist').current.type.value).toBe('artist');
  });

  it('reads the old plural values as their singular type', () => {
    expect(setup('/media/browse?type=shows').current.type.value).toBe('show');
    expect(setup('/media/browse?type=movies').current.type.value).toBe('movie');
  });

  it('falls back to the given default for a type outside the given options', () => {
    const options = ['all', 'movie', 'show'] as const;
    expect(setup('/library/quality?type=artist', options).current.type.value).toBe('all');
    expect(setup('/library/quality?type=movie', options).current.type.value).toBe('movie');
    expect(setup('/library/quality', options, 'show').current.type.value).toBe('show');
  });

  it('writes the type into the URL in place, keeping the range', () => {
    const result = setup('/library/genres?period=week');

    act(() => result.current.type.setValue('show'));

    expect(result.current.location.search).toBe('?period=week&type=show');
    expect(result.current.type.value).toBe('show');
    expect(result.current.action).toBe('REPLACE');
  });
});
