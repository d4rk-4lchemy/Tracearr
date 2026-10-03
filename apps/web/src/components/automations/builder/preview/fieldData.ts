import { fitText, textSize, type DestinationTextProfile, type TextLimit } from '@tracearr/shared';

const DISCORD_ESCAPED = /\\([\\*_~`|>#\-[\]()])/g;

export interface FieldData {
  text: string | undefined;
  used: number;
  limit: TextLimit | null;
}

/** Fits the text the way the server does, after escaping, then drops the escapes Discord hides. */
export function fieldData(
  sent: string,
  profile: DestinationTextProfile,
  limit: TextLimit | null
): FieldData {
  const fitted = limit ? fitText(sent, limit) : sent;
  const out = profile.escape === 'discordMarkdown' ? fitted.replace(DISCORD_ESCAPED, '$1') : fitted;
  const text = out.trim() === '' ? undefined : out;
  return {
    text,
    used: limit && text !== undefined ? textSize(sent, limit.unit) : 0,
    limit,
  };
}

export const overLimit = (data: FieldData) => data.limit !== null && data.used > data.limit.max;
