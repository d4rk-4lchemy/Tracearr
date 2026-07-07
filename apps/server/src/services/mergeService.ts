/**
 * User merge service
 *
 * Implements the users-level merge from the auth overhaul design:
 * absorb a source identity into a target identity, combine same-server
 * accounts, record an audit row, and support split as the undo path.
 */

import { canLogin, type UserRole } from '@tracearr/shared';

export interface MergeIdentitySnapshot {
  id: string;
  role: UserRole;
  passwordHash: string | null;
  plexAccountId: string | null;
  linkedPlexAccountCount: number;
  // Better Auth account rows for this user, any provider (credential/plex/OIDC).
  // Tracked separately from passwordHash because users.password_hash is
  // scheduled to be dropped in a later cleanup release.
  authAccountCount: number;
}

export class MergeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MergeValidationError';
    Object.setPrototypeOf(this, MergeValidationError.prototype);
  }
}

export class MergeDirectionError extends MergeValidationError {
  constructor(message: string) {
    super(message);
    this.name = 'MergeDirectionError';
    Object.setPrototypeOf(this, MergeDirectionError.prototype);
  }
}

export class SameServerCombineNotConfirmedError extends MergeValidationError {
  constructor(message: string) {
    super(message);
    this.name = 'SameServerCombineNotConfirmedError';
    Object.setPrototypeOf(this, SameServerCombineNotConfirmedError.prototype);
  }
}

export function isLoginCapable(user: MergeIdentitySnapshot): boolean {
  return (
    canLogin(user.role) ||
    user.passwordHash !== null ||
    user.plexAccountId !== null ||
    user.linkedPlexAccountCount > 0 ||
    user.authAccountCount > 0
  );
}

export function assertMergeDirection(
  source: MergeIdentitySnapshot,
  target: MergeIdentitySnapshot
): void {
  void target;
  if (isLoginCapable(source)) {
    throw new MergeDirectionError(
      'A login-capable account can only be the target of a merge, never the absorbed side'
    );
  }
}

export interface ServerUserRef {
  id: string;
  serverId: string;
}

export interface MergePlan {
  repointServerUserIds: string[];
  combines: { sourceServerUserId: string; targetServerUserId: string; serverId: string }[];
}

export function planServerUserMoves(
  sourceServerUsers: ServerUserRef[],
  targetServerUsers: ServerUserRef[]
): MergePlan {
  const targetByServer = new Map(targetServerUsers.map((su) => [su.serverId, su]));
  const plan: MergePlan = { repointServerUserIds: [], combines: [] };

  for (const sourceSu of sourceServerUsers) {
    const targetSu = targetByServer.get(sourceSu.serverId);
    if (targetSu) {
      plan.combines.push({
        sourceServerUserId: sourceSu.id,
        targetServerUserId: targetSu.id,
        serverId: sourceSu.serverId,
      });
    } else {
      plan.repointServerUserIds.push(sourceSu.id);
    }
  }

  return plan;
}
