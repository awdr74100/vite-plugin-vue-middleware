import { describe, it, expect, vi, beforeEach } from 'vitest';

import { setupMiddleware, defineMiddleware, __executeMiddleware } from '../src/runtime';

describe('runtime: setupMiddleware', () => {
  let router: any;
  let beforeEachHandler: any;

  beforeEach(() => {
    beforeEachHandler = null;
    router = {
      beforeEach: vi.fn((handler) => {
        beforeEachHandler = handler;
      }),
      install: vi.fn(),
    };
  });

  it('should register a beforeEach guard', () => {
    setupMiddleware(router as any, [], {});
    expect(router.beforeEach).toHaveBeenCalledOnce();
  });

  it('should execute global middleware in order', async () => {
    const callOrder: string[] = [];
    const m1 = defineMiddleware(async () => {
      callOrder.push('m1');
    });
    const m2 = defineMiddleware(async () => {
      callOrder.push('m2');
    });

    setupMiddleware(router as any, [m1, m2], {});

    const to = { meta: {} } as any;
    const from = {} as any;

    await beforeEachHandler(to, from);
    expect(callOrder).toEqual(['m1', 'm2']);
  });

  it('should stop and return the result if global middleware redirects', async () => {
    const m1 = defineMiddleware(async () => '/login');
    const m2 = vi.fn();

    setupMiddleware(router as any, [m1, m2 as any], {});

    const result = await beforeEachHandler({ meta: {} } as any, {} as any);
    expect(result).toBe('/login');
    expect(m2).not.toHaveBeenCalled();
  });

  it('should handle named middleware from route meta', async () => {
    const callOrder: string[] = [];
    const m1 = defineMiddleware(async () => {
      callOrder.push('m1');
    });
    const named = {
      auth: defineMiddleware(async () => {
        callOrder.push('auth');
      }),
    };

    setupMiddleware(router as any, [m1], named);

    const to = { meta: { middleware: 'auth' } } as any;

    await beforeEachHandler(to, {} as any);
    expect(callOrder).toEqual(['m1', 'auth']);
  });

  it('should handle multiple named middleware in route meta array', async () => {
    const callOrder: string[] = [];
    const named = {
      a: defineMiddleware(async () => {
        callOrder.push('a');
      }),
      b: defineMiddleware(async () => {
        callOrder.push('b');
      }),
    };

    setupMiddleware(router as any, [], named);

    const to = { meta: { middleware: ['a', 'b'] } } as any;

    await beforeEachHandler(to, {} as any);
    expect(callOrder).toEqual(['a', 'b']);
  });

  it('should warn if named middleware is not found', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setupMiddleware(router as any, [], {});

    const to = { meta: { middleware: 'missing' } } as any;

    await beforeEachHandler(to, {} as any);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Middleware "missing" not found'),
    );
    consoleSpy.mockRestore();
  });

  it('should handle errors thrown in middleware', async () => {
    const error = new Error('fail');
    const m1 = defineMiddleware(async () => {
      throw error;
    });

    setupMiddleware(router as any, [m1], {});

    await expect(beforeEachHandler({ meta: {} } as any, {} as any)).rejects.toThrow('fail');
  });

  it('should handle Error instances returned from middleware', async () => {
    const error = new Error('returned fail');
    const m1 = defineMiddleware(async () => error);

    setupMiddleware(router as any, [m1], {});

    await expect(beforeEachHandler({ meta: {} } as any, {} as any)).rejects.toThrow(
      'returned fail',
    );
  });
});

describe('runtime: __executeMiddleware', () => {
  it('should execute a synchronous generator as middleware', () => {
    const middleware = __executeMiddleware(function* (_to: any, _from: any) {
      return '/home';
    } as any);

    const result = middleware({} as any, {} as any, () => {});
    // Synchronous generator completes immediately
    expect(result).toBe('/home');
  });

  it('should handle yields (async) and return final value', async () => {
    const middleware = __executeMiddleware(function* (_to: any, _from: any) {
      const a = (yield Promise.resolve(1)) as number;
      const b = (yield Promise.resolve(2)) as number;
      return a + b;
    } as any);

    const result = await middleware({} as any, {} as any, () => {});
    expect(result).toBe(3);
  });

  it('should pass to, from, next arguments to the generator', () => {
    const to = { path: '/target' } as any;
    const from = { path: '/source' } as any;
    const next = () => {};

    let receivedTo: any, receivedFrom: any, receivedNext: any;

    const middleware = __executeMiddleware(function* (t: any, f: any, n: any) {
      receivedTo = t;
      receivedFrom = f;
      receivedNext = n;
    } as any);

    middleware(to, from, next);
    expect(receivedTo).toBe(to);
    expect(receivedFrom).toBe(from);
    expect(receivedNext).toBe(next);
  });

  it('should propagate errors thrown inside the generator', async () => {
    const middleware = __executeMiddleware(function* () {
      yield Promise.resolve('ok');
      throw new Error('generator error');
    } as any);

    await expect(middleware({} as any, {} as any, () => {})).rejects.toThrow('generator error');
  });

  it('should propagate rejected promise errors into the generator', async () => {
    let caughtError: any;
    const middleware = __executeMiddleware(function* () {
      try {
        yield Promise.reject(new Error('async fail'));
      } catch (e) {
        caughtError = e;
      }
      return 'recovered';
    } as any);

    const result = await middleware({} as any, {} as any, () => {});
    expect(result).toBe('recovered');
    expect(caughtError).toBeInstanceOf(Error);
    expect((caughtError as Error).message).toBe('async fail');
  });

  it('should reject if generator does not catch a rejected promise', async () => {
    const middleware = __executeMiddleware(function* () {
      yield Promise.reject(new Error('unhandled'));
    } as any);

    await expect(middleware({} as any, {} as any, () => {})).rejects.toThrow('unhandled');
  });

  it('should execute each segment sequentially', async () => {
    const order: string[] = [];

    const middleware = __executeMiddleware(function* () {
      order.push('before-first-yield');
      yield Promise.resolve();
      order.push('after-first-yield');
      yield Promise.resolve();
      order.push('after-second-yield');
    } as any);

    await middleware({} as any, {} as any, () => {});
    expect(order).toEqual(['before-first-yield', 'after-first-yield', 'after-second-yield']);
  });
});
