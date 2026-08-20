/**
 * The API carries scope in three mutually exclusive nullable columns. Holding
 * them as three pieces of UI state let a half-filled picker serialize to
 * all-null, silently saving a targeted rule as a global one.
 */

import type { RuleConditions } from '@tracearr/shared';
import { IDENTITY_AWARE_CONDITION_FIELDS } from '@tracearr/shared';

export type RuleScopeMode = 'global' | 'server' | 'account' | 'person';

export type RuleScope =
  | { mode: 'global' }
  | { mode: 'server'; serverId: string }
  | { mode: 'account'; serverId: string; serverUserId: string }
  | { mode: 'person'; userId: string };

export const RULE_SCOPE_MODES: readonly RuleScopeMode[] = [
  'global',
  'server',
  'account',
  'person',
] as const;

export interface RuleScopePayload {
  serverId: string | null;
  serverUserId: string | null;
  userId: string | null;
}

interface ScopedRuleFields {
  serverId?: string | null;
  serverUserId?: string | null;
  userId?: string | null;
}

export function scopeToPayload(scope: RuleScope): RuleScopePayload {
  switch (scope.mode) {
    case 'server':
      return { serverId: scope.serverId, serverUserId: null, userId: null };
    case 'account':
      return { serverId: null, serverUserId: scope.serverUserId, userId: null };
    case 'person':
      return { serverId: null, serverUserId: null, userId: scope.userId };
    case 'global':
      return { serverId: null, serverUserId: null, userId: null };
  }
}

// Account scope carries a serverId only so the picker knows whose roster to
// list; the API does not store it, so the caller resolves it from the account.
export function scopeFromRule(rule: ScopedRuleFields | undefined, accountServerId = ''): RuleScope {
  if (rule?.userId) return { mode: 'person', userId: rule.userId };
  if (rule?.serverUserId) {
    return { mode: 'account', serverId: accountServerId, serverUserId: rule.serverUserId };
  }
  if (rule?.serverId) return { mode: 'server', serverId: rule.serverId };
  return { mode: 'global' };
}

// Keeps a chosen server when moving between modes that both use one.
export function withScopeMode(
  scope: RuleScope,
  mode: RuleScopeMode,
  fallbackServerId = ''
): RuleScope {
  if (scope.mode === mode) return scope;
  const serverId = 'serverId' in scope && scope.serverId ? scope.serverId : fallbackServerId;

  switch (mode) {
    case 'global':
      return { mode: 'global' };
    case 'server':
      return { mode: 'server', serverId };
    case 'account':
      return { mode: 'account', serverId, serverUserId: '' };
    case 'person':
      return { mode: 'person', userId: '' };
  }
}

export function isScopeComplete(scope: RuleScope): boolean {
  switch (scope.mode) {
    case 'global':
      return true;
    case 'server':
      return scope.serverId !== '';
    case 'account':
      return scope.serverId !== '' && scope.serverUserId !== '';
    case 'person':
      return scope.userId !== '';
  }
}

// Server-scoped rules evaluate one server's sessions, and the backend rejects
// the combination, so cross-server enforcement is off the table there.
export function canEnforceAcrossServers(scope: RuleScope, conditions: RuleConditions): boolean {
  if (scope.mode === 'server') return false;
  const identityAware = IDENTITY_AWARE_CONDITION_FIELDS as readonly string[];
  return conditions.groups.some((group) =>
    group.conditions.some((condition) => identityAware.includes(condition.field))
  );
}
