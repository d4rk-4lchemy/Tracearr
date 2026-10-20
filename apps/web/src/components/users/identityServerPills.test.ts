import { describe, it, expect } from 'vitest';
import { getIdentityServers } from './identityServerPills';

describe('getIdentityServers', () => {
  const ownServer = { id: 'srv-a', name: 'Plex' };

  it('falls back to the own server when identityServers is undefined', () => {
    expect(getIdentityServers(undefined, ownServer)).toEqual([ownServer]);
  });

  it('falls back to the own server when identityServers is empty', () => {
    expect(getIdentityServers([], ownServer)).toEqual([ownServer]);
  });

  it('returns all memberships for a merged identity', () => {
    const servers = [ownServer, { id: 'srv-b', name: 'Jellyfin' }];
    expect(getIdentityServers(servers, ownServer)).toEqual(servers);
  });
});
