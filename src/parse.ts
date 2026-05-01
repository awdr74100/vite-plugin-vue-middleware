import fs from 'node:fs/promises';

import path from 'pathe';
import { glob } from 'tinyglobby';

/** A discovered middleware file with its parsed metadata */
export type MiddlewareFile = {
  name: string;
  path: string;
  isGlobal: boolean;
  order: number;
};

const MIDDLEWARE_GLOB = ['**/*.{ts,js}'];
const GLOBAL_SUFFIX = '.global';
const ORDER_PREFIX_RE = /^(\d+)\.(.+)$/;

/**
 * Scan the middleware directory and return parsed file metadata.
 *
 * Naming rules:
 *
 * - `<name>.global.{ts,js}` → global middleware (runs on every navigation)
 * - `<n>.<name>.{ts,js}` → numeric prefix becomes the execution order
 * - Nested files use `-` as the separator, e.g. `nested/logger.ts` → `nested-logger`
 *
 * Files are sorted by `order` ascending, with `name` as a deterministic tie-breaker.
 *
 * @param dir Absolute directory path
 * @param exclude Glob patterns to ignore (forwarded to tinyglobby)
 */
export async function parseMiddlewareFiles(
  dir: string,
  exclude: string[] = [],
): Promise<MiddlewareFile[]> {
  try {
    await fs.access(dir);
  } catch {
    return [];
  }

  const allFiles = await glob(MIDDLEWARE_GLOB, {
    cwd: dir,
    absolute: true,
    ignore: exclude,
  });

  const middlewareFiles = allFiles.map((fullPath) => parseSingleFile(dir, fullPath));

  return middlewareFiles.sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return a.name.localeCompare(b.name);
  });
}

function parseSingleFile(dir: string, fullPath: string): MiddlewareFile {
  const relPath = path.relative(dir, fullPath);
  const nameWithoutExt = relPath.replace(/\.[^.]+$/, '');

  let isGlobal = false;
  let trimmed = nameWithoutExt;

  if (trimmed.endsWith(GLOBAL_SUFFIX)) {
    isGlobal = true;
    trimmed = trimmed.slice(0, -GLOBAL_SUFFIX.length);
  }

  const parts = trimmed.split('/');
  const lastPart = parts[parts.length - 1];
  const match = lastPart.match(ORDER_PREFIX_RE);

  let order = 0;
  if (match) {
    order = parseInt(match[1], 10);
    parts[parts.length - 1] = match[2];
  }

  return {
    name: parts.join('-'),
    path: fullPath,
    isGlobal,
    order,
  };
}
