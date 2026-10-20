/**
 * Shared utilities for user components
 */
import { isDirectAvatarUrl } from '@tracearr/shared';
import { imageProxyUrl } from '@/lib/api';

/**
 * Generate proxied avatar URL for user thumbnails
 */
export function getAvatarUrl(
  serverId: string | null | undefined,
  thumbUrl: string | null | undefined,
  size = 100
): string | null {
  if (!thumbUrl) return null;
  if (thumbUrl.startsWith('http')) return isDirectAvatarUrl(thumbUrl) ? thumbUrl : null;
  // Otherwise, proxy through our server
  if (!serverId) return null;
  return imageProxyUrl(serverId, thumbUrl, size, size, 'avatar');
}
