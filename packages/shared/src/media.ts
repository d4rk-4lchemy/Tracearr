/**
 * Media display formatting shared across web, mobile, and server notifications.
 */

export interface FormatEpisodeLabelOptions {
  /** When provided, the label is only produced if this equals 'episode'. */
  mediaType?: string | null;
  /** Use "S01 E02" instead of the default "S01E02". */
  spaced?: boolean;
}

/**
 * Format a season/episode pair into a zero-padded label (e.g. "S00E01").
 * Season 0 and episode 0 are valid (Specials) and must render, not be hidden -
 * only a genuinely missing (null/undefined) season or episode suppresses the label.
 */
export function formatEpisodeLabel(
  seasonNumber: number | null | undefined,
  episodeNumber: number | null | undefined,
  options: FormatEpisodeLabelOptions = {}
): string | null {
  if (options.mediaType !== undefined && options.mediaType !== 'episode') return null;
  if (seasonNumber == null || episodeNumber == null) return null;

  const season = String(seasonNumber).padStart(2, '0');
  const episode = String(episodeNumber).padStart(2, '0');
  return options.spaced ? `S${season} E${episode}` : `S${season}E${episode}`;
}
