export interface IdentityServerMembership {
  id: string;
  name: string;
  serverUserId?: string;
  removedAt?: string | null;
}

/**
 * Every server an identity belongs to, always including at least its own server.
 */
export function getIdentityServers(
  identityServers: IdentityServerMembership[] | undefined,
  ownServer: IdentityServerMembership
): IdentityServerMembership[] {
  if (!identityServers || identityServers.length === 0) return [ownServer];
  return identityServers;
}
