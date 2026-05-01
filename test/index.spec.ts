import fs from 'node:fs/promises';

import { glob } from 'tinyglobby';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { generateDts, parseMiddlewareFiles } from '../src/index';

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

  it('should sort by name as a stable secondary key when orders tie', async () => {
    vi.mocked(fs.access).mockResolvedValue(undefined);
    // Return in deliberately reversed alphabetical order
    vi.mocked(glob).mockResolvedValue(['/base/zeta.ts', '/base/alpha.ts', '/base/mike.ts']);

    const result = await parseMiddlewareFiles('/base');
    expect(result.map((m) => m.name)).toEqual(['alpha', 'mike', 'zeta']);
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

    await generateDts(files as any, '/types/out.d.ts');

    expect(fs.mkdir).toHaveBeenCalledWith('/types', { recursive: true });
    expect(fs.writeFile).toHaveBeenCalledWith(
      '/types/out.d.ts',
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

  it('should skip writing when on-disk content is identical', async () => {
    const files = [{ name: 'auth', path: '', isGlobal: false, order: 0 }];

    // First call writes
    await generateDts(files as any, '/out.d.ts');
    const firstWriteCall = vi.mocked(fs.writeFile).mock.calls[0];
    const writtenContent = firstWriteCall![1] as string;

    // Reset and simulate the file already containing the same content
    vi.clearAllMocks();
    vi.mocked(fs.readFile).mockResolvedValue(writtenContent as any);

    await generateDts(files as any, '/out.d.ts');

    expect(fs.writeFile).not.toHaveBeenCalled();
    expect(fs.mkdir).not.toHaveBeenCalled();
  });
});
