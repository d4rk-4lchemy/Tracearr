import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../db/client.js', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue([
            {
              id: 'server-1',
              type: 'dispatcharr',
              url: 'http://dispatcharr.local',
              token: 'secret-api-key',
            },
          ]),
        })),
      })),
    })),
  },
}));

vi.mock('../../db/schema.js', () => ({
  servers: { id: 'id' },
}));

vi.mock('sharp', () => ({
  default: vi.fn(() => ({
    resize: vi.fn().mockReturnThis(),
    webp: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('resized-image')),
  })),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch as typeof global.fetch;

import { proxyImage, stopImageCacheCleanup } from '../imageProxy.js';

describe('proxyImage', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(Uint8Array.from([1, 2, 3]).buffer),
    });
  });

  afterAll(() => {
    stopImageCacheCleanup();
  });

  it('does not send auth headers for Dispatcharr relative image paths', async () => {
    const imagePath = `/media/channels/1/logo.png?ts=${Date.now()}`;

    await proxyImage({
      serverId: 'server-1',
      imagePath,
    });

    expect(mockFetch).toHaveBeenCalledWith(
      `http://dispatcharr.local${imagePath}`,
      expect.objectContaining({
        headers: {
          Accept: 'image/*',
        },
      })
    );
  });

  it('does not send auth headers for Dispatcharr absolute image URLs', async () => {
    const imageUrl = `https://cdn.example.com/channel-logo.png?ts=${Date.now()}`;

    await proxyImage({
      serverId: 'server-1',
      imagePath: imageUrl,
    });

    expect(mockFetch).toHaveBeenCalledWith(
      imageUrl,
      expect.objectContaining({
        headers: {
          Accept: 'image/*',
        },
      })
    );
  });
});
