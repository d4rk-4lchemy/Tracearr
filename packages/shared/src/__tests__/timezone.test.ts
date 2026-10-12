import { describe, expect, it } from 'vitest';
import { timezoneSchema } from '../schemas.js';

describe('timezoneSchema', () => {
  it.each(['America/New_York', 'UTC', 'Etc/GMT+5'])('accepts %s', (tz) => {
    expect(timezoneSchema.safeParse(tz).success).toBe(true);
  });

  it.each(['+05:00', '-08:00', '+0530', 'Mars/Olympus'])('rejects %s', (tz) => {
    expect(timezoneSchema.safeParse(tz).success).toBe(false);
  });
});
