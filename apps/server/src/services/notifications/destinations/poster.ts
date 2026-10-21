import { POSTER_IMAGE_SIZE } from '@tracearr/shared';
import { proxyImage } from '../../imageProxy.js';

export interface Poster {
  data: Buffer;
  contentType: string;
}

/** The receiving platform picks the renderer off the extension, so the name has to match the bytes. */
const POSTER_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export function posterFilename(contentType: string): string {
  const base = contentType.split(';')[0]?.trim() ?? '';
  return `poster.${POSTER_EXTENSIONS[base] ?? 'jpg'}`;
}

/**
 * The poster, as bytes. A miss degrades to no thumbnail rather than failing the send -
 * proxyImage answers an unreachable server with an SVG placeholder, which the receiving
 * platform will not render, so only a raster image is worth uploading.
 */
export async function fetchPoster(
  serverId: string,
  thumbPath: string | null
): Promise<Poster | undefined> {
  if (thumbPath === null || thumbPath === '') return undefined;
  try {
    const result = await proxyImage({
      serverId,
      imagePath: thumbPath,
      ...POSTER_IMAGE_SIZE,
      fallback: 'poster',
    });
    if (!result.contentType.startsWith('image/') || result.contentType.includes('svg')) {
      return undefined;
    }
    return { data: result.data, contentType: result.contentType };
  } catch {
    return undefined;
  }
}
