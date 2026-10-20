import type { UserRole } from '@tracearr/shared';

export const ROLE_LABEL_KEYS = {
  owner: 'common:labels.serverOwner',
  admin: 'pages:userDetail.access.roleAdmin',
  member: 'pages:userDetail.access.roleMember',
  disabled: 'common:states.disabled',
  pending: 'common:states.pending',
} as const satisfies Record<UserRole, string>;
