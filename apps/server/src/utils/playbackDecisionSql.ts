import { type SQL, sql } from 'drizzle-orm';

const column = (alias: string | undefined) => (name: string) =>
  sql.raw(alias ? `${alias}.${name}` : name);

/** SQL twin of `playbackDecision()` in @tracearr/shared; the two must agree. */
export function playbackDecisionSql(alias?: string): SQL {
  const col = column(alias);
  return sql`CASE
    WHEN ${col('is_transcode')} = true AND ${col('audio_decision')} = 'transcode' AND ${col('video_decision')} IS DISTINCT FROM 'transcode' THEN 'audio_transcode'
    WHEN ${col('is_transcode')} = true THEN 'transcode'
    WHEN ${col('video_decision')} = 'copy' OR ${col('audio_decision')} = 'copy' THEN 'copy'
    ELSE 'directplay'
  END`;
}

/** SQL twin of `isSubtitleBurnIn()` in @tracearr/shared; the two must agree. */
export function subtitleBurnInSql(alias?: string): SQL {
  const col = column(alias);
  return sql`COALESCE(${col('subtitle_info')}->>'decision' = 'burn' OR ${col('transcode_info')}->'reasons' @> '["SubtitleCodecNotSupported"]'::jsonb, false)`;
}
