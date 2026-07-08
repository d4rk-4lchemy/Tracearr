/**
 * Pure helper deciding when to render server membership pills for an identity.
 * Unmerged (single-server) identities render nothing - no pill noise.
 */

export interface IdentityServerMembership {
  id: string;
  name: string;
}

export function getMergedIdentityServers(
  identityServers: IdentityServerMembership[] | undefined
): IdentityServerMembership[] {
  if (!identityServers || identityServers.length < 2) return [];
  return identityServers;
}
