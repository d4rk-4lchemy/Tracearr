/**
 * Local Auth Routes Tests
 *
 * Tests for local authentication signup and login
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';

// Mock the database and services
vi.mock('../../../db/client.js', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
  },
}));

vi.mock('../../../services/userService.js', () => ({
  getUserByEmail: vi.fn(),
  getOwnerUser: vi.fn(),
}));

vi.mock('../../../utils/password.js', () => ({
  hashPassword: vi.fn().mockResolvedValue('hashed-password'),
  verifyPassword: vi.fn(),
}));

vi.mock('../../../utils/claimCode.js', () => ({
  validateClaimCode: vi.fn(),
  isClaimCodeEnabled: vi.fn(),
}));

// Import mocked modules
import { db } from '../../../db/client.js';
import { getUserByEmail, getOwnerUser } from '../../../services/userService.js';
import { validateClaimCode, isClaimCodeEnabled } from '../../../utils/claimCode.js';
import { localRoutes } from '../local.js';

// Mock Redis client
const mockRedis = {
  get: vi.fn(),
  setex: vi.fn(),
};

// Helper to mock db.insert (pattern from plex.test.ts)
function mockDbInsert(result: unknown[]) {
  const chain = {
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(result),
  };
  vi.mocked(db.insert).mockReturnValue(chain as never);
  return chain;
}

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  await app.register(sensible);
  await app.register(cookie, { secret: 'test-cookie-secret' });
  await app.register(jwt, {
    secret: 'test-jwt-secret-must-be-32-chars-minimum',
    sign: { algorithm: 'HS256' },
  });

  // Decorate app with mock Redis
  app.decorate('redis', mockRedis as any);

  await app.register(localRoutes, { prefix: '/auth' });

  return app;
}

describe('Local Auth Routes', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset Redis mocks
    mockRedis.get.mockReset();
    mockRedis.setex.mockReset();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  describe('POST /auth/signup', () => {
    describe('when claim code is enabled', () => {
      beforeEach(() => {
        vi.mocked(isClaimCodeEnabled).mockReturnValue(true);
      });

      it('requires claim code in request for first user', async () => {
        app = await buildTestApp();

        // Mock: no existing user with email, no owner exists (first user)
        vi.mocked(getUserByEmail).mockResolvedValue(null);
        vi.mocked(getOwnerUser).mockResolvedValue(null);

        const response = await app.inject({
          method: 'POST',
          url: '/auth/signup',
          payload: {
            username: 'testuser',
            email: 'test@example.com',
            password: 'password123',
            // Missing claimCode
          },
        });

        expect(response.statusCode).toBe(403);
        expect(response.json().message).toContain('Claim code is required');
      });

      it('rejects invalid claim code for first user', async () => {
        app = await buildTestApp();

        vi.mocked(getUserByEmail).mockResolvedValue(null);
        vi.mocked(getOwnerUser).mockResolvedValue(null);
        vi.mocked(validateClaimCode).mockReturnValue(false);

        const response = await app.inject({
          method: 'POST',
          url: '/auth/signup',
          payload: {
            username: 'testuser',
            email: 'test@example.com',
            password: 'password123',
            claimCode: 'WRONG-CODE',
          },
        });

        expect(response.statusCode).toBe(403);
        expect(response.json().message).toContain('Invalid claim code');
        expect(validateClaimCode).toHaveBeenCalledWith('WRONG-CODE');
      });

      it('allows signup with valid claim code for first user', async () => {
        app = await buildTestApp();

        vi.mocked(getUserByEmail).mockResolvedValue(null);
        vi.mocked(getOwnerUser).mockResolvedValue(null);
        vi.mocked(validateClaimCode).mockReturnValue(true);

        // Mock db.select for getAllServerIds()
        const selectChain = {
          from: vi.fn().mockResolvedValue([]),
        };
        vi.mocked(db.select).mockReturnValue(selectChain as never);

        // Mock db insert to return new user
        mockDbInsert([
          {
            id: 'user-123',
            username: 'testuser',
            email: 'test@example.com',
            role: 'owner',
          },
        ]);

        const response = await app.inject({
          method: 'POST',
          url: '/auth/signup',
          payload: {
            username: 'testuser',
            email: 'test@example.com',
            password: 'password123',
            claimCode: 'ABCD-EFGH-JKLM',
          },
        });

        expect(response.statusCode).toBe(200);
        expect(validateClaimCode).toHaveBeenCalledWith('ABCD-EFGH-JKLM');
        expect(response.json()).toHaveProperty('accessToken');
        expect(response.json()).toHaveProperty('refreshToken');
      });

      it('rejects signup when owner already exists (Issue #392)', async () => {
        app = await buildTestApp();

        vi.mocked(getUserByEmail).mockResolvedValue(null);
        vi.mocked(getOwnerUser).mockResolvedValue({
          id: 'owner-123',
          username: 'owner',
          displayUsername: null,
          email: 'owner@example.com',
          emailVerified: false,
          role: 'owner',
          passwordHash: 'hash',
          createdAt: new Date(),
          updatedAt: new Date(),
          name: null,
          plexAccountId: null,
          thumbnail: null,
          apiToken: null,
          banned: null,
          banReason: null,
          banExpires: null,
          aggregateTrustScore: 100,
          totalViolations: 0,
        }); // Owner exists

        const response = await app.inject({
          method: 'POST',
          url: '/auth/signup',
          payload: {
            username: 'viewer',
            email: 'viewer@example.com',
            password: 'password123',
          },
        });

        // SECURITY: Only the first user can sign up - all subsequent signups are rejected
        expect(response.statusCode).toBe(403);
        expect(response.json().message).toContain('already has an owner');
      });
    });

    describe('when claim code is disabled', () => {
      beforeEach(() => {
        vi.mocked(isClaimCodeEnabled).mockReturnValue(false);
      });

      it('allows first user signup without claim code', async () => {
        app = await buildTestApp();

        vi.mocked(getUserByEmail).mockResolvedValue(null);
        vi.mocked(getOwnerUser).mockResolvedValue(null); // First user

        // Mock db.select for getAllServerIds()
        const selectChain = {
          from: vi.fn().mockResolvedValue([]),
        };
        vi.mocked(db.select).mockReturnValue(selectChain as never);

        // Mock db insert to return new user
        mockDbInsert([
          {
            id: 'user-123',
            username: 'testuser',
            email: 'test@example.com',
            role: 'owner',
          },
        ]);

        const response = await app.inject({
          method: 'POST',
          url: '/auth/signup',
          payload: {
            username: 'testuser',
            email: 'test@example.com',
            password: 'password123',
          },
        });

        expect(response.statusCode).toBe(200);
        expect(mockRedis.get).not.toHaveBeenCalled(); // Should not check Redis when disabled
        expect(response.json()).toHaveProperty('accessToken');
      });
    });

    it('rejects signup with missing fields', async () => {
      app = await buildTestApp();

      const response = await app.inject({
        method: 'POST',
        url: '/auth/signup',
        payload: {
          email: 'test@example.com',
          // Missing username and password
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('rejects signup with weak password', async () => {
      app = await buildTestApp();

      const response = await app.inject({
        method: 'POST',
        url: '/auth/signup',
        payload: {
          username: 'testuser',
          email: 'test@example.com',
          password: 'short', // Too short
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('rejects signup with invalid email', async () => {
      app = await buildTestApp();

      const response = await app.inject({
        method: 'POST',
        url: '/auth/signup',
        payload: {
          username: 'testuser',
          email: 'not-an-email',
          password: 'password123',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('rejects signup with existing email', async () => {
      app = await buildTestApp();

      vi.mocked(getUserByEmail).mockResolvedValue({
        id: 'existing-123',
        username: 'existing',
        displayUsername: null,
        email: 'test@example.com',
        emailVerified: false,
        role: 'viewer',
        passwordHash: 'hash',
        createdAt: new Date(),
        updatedAt: new Date(),
        name: null,
        plexAccountId: null,
        thumbnail: null,
        apiToken: null,
        banned: null,
        banReason: null,
        banExpires: null,
        aggregateTrustScore: 100,
        totalViolations: 0,
      });

      const response = await app.inject({
        method: 'POST',
        url: '/auth/signup',
        payload: {
          username: 'testuser',
          email: 'test@example.com',
          password: 'password123',
        },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json().message).toContain('Email already registered');
    });
  });
});
