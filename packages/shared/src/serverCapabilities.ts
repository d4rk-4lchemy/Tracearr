import type { ServerType } from './types.js';
export const SERVER_CAPABILITIES: Record<ServerType, { mediaLibrary: boolean }> = {
  plex: { mediaLibrary: true }, jellyfin: { mediaLibrary: true }, emby: { mediaLibrary: true }, dispatcharr: { mediaLibrary: false },
};
export function supportsMediaLibrary(type: ServerType): boolean { return SERVER_CAPABILITIES[type].mediaLibrary; }
