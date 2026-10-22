import { describe, it, expect } from 'vitest';
import type { MediaDownloadRow } from '@tracearr/shared';
import { deliveredFormat, deliveredSize, isConvertedDownload } from './DownloadsTable';

const base = {
  source: 'activity_log',
  videoResolution: '1080p',
  deliveredResolution: null,
  fileSizeBytes: 1000,
  deliveredBytes: null,
} as MediaDownloadRow;

describe('isConvertedDownload', () => {
  it('is true when the delivered resolution falls in a lower tier than the source', () => {
    expect(isConvertedDownload({ ...base, deliveredResolution: '1280x720' })).toBe(true);
  });

  it('is false when the delivered resolution is in the source tier', () => {
    expect(isConvertedDownload({ ...base, deliveredResolution: '1920x1080' })).toBe(false);
  });

  it('falls to the bytes rule when the source resolution is unknown', () => {
    const unknownSource = { ...base, videoResolution: null, deliveredResolution: '720x404' };
    expect(isConvertedDownload(unknownSource)).toBe(false);
    expect(isConvertedDownload({ ...unknownSource, deliveredBytes: 900 })).toBe(true);
  });

  it('is true when the delivered bytes are under 95 percent of the file', () => {
    expect(isConvertedDownload({ ...base, deliveredBytes: 900 })).toBe(true);
  });

  it('is false for a whole-file delivery or missing sizes', () => {
    expect(isConvertedDownload({ ...base, deliveredBytes: 960 })).toBe(false);
    expect(isConvertedDownload({ ...base, deliveredBytes: null })).toBe(false);
    expect(isConvertedDownload({ ...base, fileSizeBytes: null, deliveredBytes: 1 })).toBe(false);
  });
});

describe('deliveredSize', () => {
  const sized = { ...base, fileSizeBytes: 2 * 1024 ** 3 };

  it('falls back to the source file size for a whole-file download', () => {
    expect(deliveredSize(sized)).toBe('2 GB');
  });

  it('shows a dash for a converted pull with no delivered byte count', () => {
    expect(deliveredSize({ ...sized, source: 'jellyfin_transcode' })).toBe('\u2014');
    expect(
      deliveredSize({ ...sized, source: 'jellyfin_transcode', deliveredBytes: 1024 ** 3 })
    ).toBe('1 GB');
  });
});

describe('deliveredFormat', () => {
  it('keeps the resolution lowercase while codecs and container are uppercased', () => {
    const row = {
      ...base,
      deliveredResolution: '720x404',
      deliveredVideoCodec: 'h264',
      deliveredAudioCodec: 'aac',
      deliveredContainer: 'mkv',
    } as MediaDownloadRow;
    expect(deliveredFormat(row)).toBe('720x404 H.264/AAC MKV');
  });
});
