import { createAccessControl } from 'better-auth/plugins/access';
import { adminAc, defaultStatements } from 'better-auth/plugins/admin/access';

const appStatements = {
  sessions: ['read', 'terminate'],
  history: ['read'],
  stats: ['read'],
  violations: ['read'],
  devices: ['read'],
  bandwidth: ['read'],
  locations: ['read'],
  requests: ['read', 'write'],
  map: ['read'],
  media: ['read'],
  // Library analytics: per-title watch counts, binges, completion, storage and quality reports
  insights: ['read'],
  users: ['read', 'write', 'merge'],
  automations: ['read', 'write'],
  runs: ['read'],
  notifications: ['read', 'write'],
  templates: ['read', 'write'],
  newsletters: ['read', 'write'],
  settings: ['read', 'write'],
  servers: ['read', 'write'],
  import: ['read', 'write'],
  backup: ['read', 'write'],
  maintenance: ['read', 'write'],
  tasks: ['read', 'write'],
  debug: ['read'],
  apiToken: ['read', 'write'],
} as const;

const statements = { ...defaultStatements, ...appStatements } as const;

const ac = createAccessControl(statements);

// Admin holds every app statement but none of better-auth's user and session statements:
// those gate the admin plugin's own endpoints (set-role, ban, impersonate, set-password),
// which would let an admin promote themselves to owner.
const allAppStatements = Object.fromEntries(
  Object.entries(appStatements).map(([k, v]) => [k, [...v]])
) as { -readonly [K in keyof typeof appStatements]: (typeof appStatements)[K][number][] };

export const roles = {
  owner: ac.newRole({ ...allAppStatements, ...adminAc.statements }),
  admin: ac.newRole(allAppStatements),
  member: ac.newRole({
    sessions: ['read'],
    history: ['read'],
    stats: ['read'],
    locations: ['read'],
    requests: ['read'],
    map: ['read'],
    media: ['read'],
  }),
};

export type Resource = keyof typeof statements;
export type Action<R extends Resource> = (typeof statements)[R][number];
