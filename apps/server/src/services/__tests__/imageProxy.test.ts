import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sharpResize: vi.fn(),
  sharpWebp: vi.fn(),
  sharpToBuffer: vi.fn(),
}));

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
    resize: mocks.sharpResize.mockReturnThis(),
    webp: mocks.sharpWebp.mockReturnThis(),
    toBuffer: mocks.sharpToBuffer.mockResolvedValue(Buffer.from('resized-image')),
  })),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch as typeof global.fetch;

import { proxyImage, stopImageCacheCleanup } from '../imageProxy.js';

describe('proxyImage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(Uint8Array.from([1, 2, 3]).buffer),
    });
  });

  afterAll(() => {
    stopImageCacheCleanup();
  });

  it('fetches Dispatcharr relative image paths without auth and preserves aspect ratio', async () => {
    const imagePath = `/api/channels/logos/4671/cache/?ts=${Date.now()}`;

    const result = await proxyImage({
      serverId: 'server-1',
      imagePath,
      width: 300,
      height: 450,
    });

    expect(mockFetch).toHaveBeenCalledWith(
      `http://dispatcharr.local${imagePath}`,
      expect.objectContaining({
        headers: {},
      })
    );
    expect(mocks.sharpResize).toHaveBeenCalledWith(300, 450, {
      fit: 'inside',
      position: 'center',
    });
    expect(result).toEqual({
      data: Buffer.from('resized-image'),
      contentType: 'image/webp',
      cached: false,
    });
  });

  it('normalizes Dispatcharr absolute image URLs and fetches through the configured server URL', async () => {
    const imagePath = `/api/channels/logos/4671/cache/?ts=${Date.now()}`;
    const imageUrl = `https://dispatcharr.example.com${imagePath}#ignored`;

    await proxyImage({
      serverId: 'server-1',
      imagePath: imageUrl,
    });

    expect(mockFetch).toHaveBeenCalledWith(
      `http://dispatcharr.local${imagePath}`,
      expect.objectContaining({
        headers: {},
      })
    );
    expect(mocks.sharpResize).toHaveBeenCalledWith(300, 450, {
      fit: 'inside',
      position: 'center',
    });
  });
});
