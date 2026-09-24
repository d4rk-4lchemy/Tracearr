/**
 * The sessions compression policy's background worker compresses the same chunks
 * these tests compress by hand, and TimescaleDB aborts the loser with 40001
 * expecting a retry. A scheduler attaches to a worker database about a minute
 * after it is created, so only a long suite run ever races.
 */

import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';

const SERIALIZATION_FAILURE = '40001';
const MAX_ATTEMPTS = 5;

function isSerializationFailure(error: unknown): boolean {
  const direct = (error as { code?: string }).code;
  const wrapped = (error as { cause?: { code?: string } }).cause?.code;
  return direct === SERIALIZATION_FAILURE || wrapped === SERIALIZATION_FAILURE;
}

export async function compressSessionChunks(olderThanDays?: number): Promise<unknown[]> {
  const chunks =
    olderThanDays === undefined
      ? sql`show_chunks('sessions')`
      : sql`show_chunks('sessions', older_than => NOW() - INTERVAL '${sql.raw(String(olderThanDays))} days')`;

  for (let attempt = 1; ; attempt++) {
    try {
      const result = await db.execute(sql`SELECT compress_chunk(c, true) FROM ${chunks} AS c`);
      return result.rows;
    } catch (error) {
      if (attempt >= MAX_ATTEMPTS || !isSerializationFailure(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
  }
}
