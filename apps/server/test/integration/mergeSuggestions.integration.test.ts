/**
 * Merge suggestion integration tests
 *
 * Run with: pnpm --filter @tracearr/server test:integration -- mergeSuggestions
 */

import { randomUUID } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import {
  createTestUser,
  createTestServer,
  createTestServerUser,
} from '@tracearr/test-utils/factories';
import { db } from '../../src/db/client.js';
import { authAccounts } from '../../src/db/schema.js';
import { getMergeSuggestions, mergeUsers } from '../../src/services/mergeService.js';

describe('getMergeSuggestions', () => {
  it('suggests identities whose server accounts share a normalized email', async () => {
    const serverA = await createTestServer({ type: 'plex' });
    const serverB = await createTestServer({ type: 'jellyfin' });
    const userA = await createTestUser({ role: 'member' });
    const userB = await createTestUser({ role: 'member' });
    await createTestServerUser({
      userId: userA.id,
      serverId: serverA.id,
      email: 'Bob@Example.com',
    });
    await createTestServerUser({
      userId: userB.id,
      serverId: serverB.id,
      email: 'bob@example.com',
    });

    const suggestions = await getMergeSuggestions();
    const match = suggestions.find(
      (s) => s.matchType === 'email' && s.matchValue === 'bob@example.com'
    );

    expect(match).toBeDefined();
    const ids = match!.users.map((u) => u.userId).sort();
    expect(ids).toEqual([userA.id, userB.id].sort());
    expect(match!.wouldCombineSameServer).toBe(false);
    expect(match!.requiredTargetUserId).toBeNull();
  });

  it('suggests exact-username matches and forces a login-capable side as target', async () => {
    const serverA = await createTestServer({ type: 'plex' });
    const serverB = await createTestServer({ type: 'jellyfin' });
    const viewer = await createTestUser({ role: 'viewer' });
    const member = await createTestUser({ role: 'member' });
    await createTestServerUser({
      userId: viewer.id,
      serverId: serverA.id,
      username: 'carol',
      email: null,
    });
    await createTestServerUser({
      userId: member.id,
      serverId: serverB.id,
      username: 'carol',
      email: null,
    });

    const suggestions = await getMergeSuggestions();
    const match = suggestions.find((s) => s.matchType === 'username' && s.matchValue === 'carol');

    expect(match).toBeDefined();
    expect(match!.requiredTargetUserId).toBe(viewer.id);
    const viewerSide = match!.users.find((u) => u.userId === viewer.id);
    expect(viewerSide?.loginCapable).toBe(true);
  });

  it('excludes pairs where both identities are login capable', async () => {
    const serverA = await createTestServer({ type: 'plex' });
    const serverB = await createTestServer({ type: 'jellyfin' });
    const admin = await createTestUser({ role: 'admin' });
    const viewer = await createTestUser({ role: 'viewer' });
    await createTestServerUser({
      userId: admin.id,
      serverId: serverA.id,
      username: 'dave',
      email: null,
    });
    await createTestServerUser({
      userId: viewer.id,
      serverId: serverB.id,
      username: 'dave',
      email: null,
    });

    const suggestions = await getMergeSuggestions();
    const match = suggestions.find((s) => s.matchValue === 'dave');
    expect(match).toBeUndefined();
  });

  it('flags pairs that would require a same-server combine', async () => {
    const server = await createTestServer({ type: 'plex' });
    const userA = await createTestUser({ role: 'member' });
    const userB = await createTestUser({ role: 'member' });
    await createTestServerUser({
      userId: userA.id,
      serverId: server.id,
      username: 'erin',
      email: null,
    });
    await createTestServerUser({
      userId: userB.id,
      serverId: server.id,
      username: 'erin',
      email: null,
    });

    const suggestions = await getMergeSuggestions();
    const match = suggestions.find((s) => s.matchValue === 'erin');
    expect(match?.wouldCombineSameServer).toBe(true);
  });

  it('stops suggesting a pair after it has been merged', async () => {
    const admin = await createTestUser({ role: 'owner' });
    const serverA = await createTestServer({ type: 'plex' });
    const serverB = await createTestServer({ type: 'jellyfin' });
    const userA = await createTestUser({ role: 'member' });
    const userB = await createTestUser({ role: 'member' });
    await createTestServerUser({
      userId: userA.id,
      serverId: serverA.id,
      email: 'frank@example.com',
    });
    await createTestServerUser({
      userId: userB.id,
      serverId: serverB.id,
      email: 'frank@example.com',
    });

    await mergeUsers(userB.id, userA.id, admin.id);

    const suggestions = await getMergeSuggestions();
    const match = suggestions.find((s) => s.matchValue === 'frank@example.com');
    expect(match).toBeUndefined();
  });

  it('treats a bare auth account row as login capable and forces it as the merge target', async () => {
    const serverA = await createTestServer({ type: 'plex' });
    const serverB = await createTestServer({ type: 'jellyfin' });
    // Both start as 'member' (not login-capable by role), but one has
    // acquired a Better Auth login account through data drift.
    const authedMember = await createTestUser({ role: 'member' });
    const plainMember = await createTestUser({ role: 'member' });
    await createTestServerUser({
      userId: authedMember.id,
      serverId: serverA.id,
      username: 'greg',
      email: null,
    });
    await createTestServerUser({
      userId: plainMember.id,
      serverId: serverB.id,
      username: 'greg',
      email: null,
    });

    await db.insert(authAccounts).values({
      id: randomUUID(),
      accountId: authedMember.id,
      providerId: 'credential',
      userId: authedMember.id,
    });

    const suggestions = await getMergeSuggestions();
    const match = suggestions.find((s) => s.matchValue === 'greg');

    expect(match).toBeDefined();
    expect(match!.requiredTargetUserId).toBe(authedMember.id);
    const authedSide = match!.users.find((u) => u.userId === authedMember.id);
    expect(authedSide?.loginCapable).toBe(true);
  });
});
