import { describe, it, expect } from 'vitest';
import { formatEpisodeLabel, isDirectAvatarUrl } from '../media.js';

describe('formatEpisodeLabel', () => {
  it('formats season 0 (Specials) as S00E01', () => {
    expect(formatEpisodeLabel(0, 1)).toBe('S00E01');
  });

  it('formats a normal season/episode pair', () => {
    expect(formatEpisodeLabel(1, 2)).toBe('S01E02');
  });

  it('returns null when season is null', () => {
    expect(formatEpisodeLabel(null, 1)).toBeNull();
  });

  it('returns null when episode is null', () => {
    expect(formatEpisodeLabel(1, null)).toBeNull();
  });

  it('returns null when season is undefined', () => {
    expect(formatEpisodeLabel(undefined, 1)).toBeNull();
  });

  it('formats season 0, episode 0 as S00E00', () => {
    expect(formatEpisodeLabel(0, 0)).toBe('S00E00');
  });

  it('returns null when mediaType is provided and is not episode', () => {
    expect(formatEpisodeLabel(1, 2, { mediaType: 'movie' })).toBeNull();
  });

  it('formats when mediaType is episode', () => {
    expect(formatEpisodeLabel(1, 2, { mediaType: 'episode' })).toBe('S01E02');
  });

  it('uses spaced format when requested', () => {
    expect(formatEpisodeLabel(1, 2, { spaced: true })).toBe('S01 E02');
  });

  it('double-digit season and episode numbers pad correctly beyond two digits', () => {
    expect(formatEpisodeLabel(10, 25)).toBe('S10E25');
  });
});

describe('isDirectAvatarUrl', () => {
  it('loads Plex account avatars straight from plex.tv', () => {
    expect(isDirectAvatarUrl('https://plex.tv/users/abc/avatar?c=1')).toBe(true);
    expect(isDirectAvatarUrl('https://assets.plex.tv/avatar.png')).toBe(true);
  });

  it('never loads any other absolute address', () => {
    expect(isDirectAvatarUrl('https://attacker.example/pixel.png')).toBe(false);
    expect(isDirectAvatarUrl('https://plex.tv.attacker.example/x')).toBe(false);
    expect(isDirectAvatarUrl('http://plex.tv/users/abc/avatar')).toBe(false);
  });
});
