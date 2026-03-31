import fs from 'node:fs/promises';

import { glob } from 'tinyglobby';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { parseMiddlewareFiles, generateDts } from '../src/index';

vi.mock('node:fs/promises');
vi.mock('tinyglobby');

describe('plugin: parseMiddlewareFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return empty array if directory is not accessible', async () => {
    vi.mocked(fs.access).mockRejectedValue(new Error('not found'));
    const result = await parseMiddlewareFiles('/missing');
    expect(result).toEqual([]);
  });

  it('should parse middleware files correctly', async () => {
    vi.mocked(fs.access).mockResolvedValue(undefined);
    vi.mocked(glob).mockResolvedValue([
      '/base/auth.ts',
      '/base/01.setup.global.ts',
      '/base/nested/logger.ts',
    ]);

    const result = await parseMiddlewareFiles('/base');

    expect(result).toHaveLength(3);

    // Auth middleware should be first due to order 0
    expect(result[0]).toMatchObject({
      name: 'auth',
      isGlobal: false,
      order: 0,
    });

    expect(result[1]).toMatchObject({
      name: 'nested-logger',
      isGlobal: false,
      order: 0,
    });

    expect(result[2]).toMatchObject({
      name: 'setup',
      isGlobal: true,
      order: 1,
    });
  });

  it('should apply exclude patterns to glob', async () => {
    vi.mocked(fs.access).mockResolvedValue(undefined);
    vi.mocked(glob).mockResolvedValue([]);

    await parseMiddlewareFiles('/base', ['**/secret.ts']);

    expect(glob).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        ignore: ['**/secret.ts'],
      }),
    );
  });
});

describe('plugin: generateDts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should write correct dts content', async () => {
    const files = [
      { name: 'auth', path: '', isGlobal: false, order: 0 },
      { name: 'log', path: '', isGlobal: true, order: 0 },
    ];

    await generateDts(files as any, '/out.d.ts');

    expect(fs.writeFile).toHaveBeenCalledWith(
      '/out.d.ts',
      expect.stringContaining('middleware?: "auth" | ("auth")[]'),
      'utf-8',
    );
  });

  it('should fallback to string if no named middleware', async () => {
    await generateDts([], '/out.d.ts');
    expect(fs.writeFile).toHaveBeenCalledWith(
      '/out.d.ts',
      expect.stringContaining('middleware?: string | (string)[]'),
      'utf-8',
    );
  });
});
