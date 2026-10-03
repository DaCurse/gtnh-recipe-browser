import { afterEach, describe, expect, it, vi } from 'vitest';
import { initializeShellUpdate } from '../src/lib/shellUpdate';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('shell update before startup', () => {
  function setup(register: () => Promise<unknown>) {
    vi.stubEnv('PROD', true);
    const events = new EventTarget();
    const workers = Object.assign(events, { controller: {}, register: vi.fn(register) });
    vi.stubGlobal('navigator', { serviceWorker: workers });
    vi.stubGlobal('document', { baseURI: 'https://example.test/app/' });
    vi.stubGlobal('location', { reload: vi.fn() });
    return workers;
  }

  it('bounds an unreachable server and lets startup proceed', async () => {
    vi.useFakeTimers();
    const workers = setup(() => new Promise(() => {}));
    const startup = initializeShellUpdate();
    await vi.advanceTimersByTimeAsync(3_000);
    await startup;
    expect(workers.register).toHaveBeenCalledWith(new URL('https://example.test/app/sw.js'), { updateViaCache: 'none' });
  });

  it('allows startup after failed worker installation', async () => {
    setup(() => Promise.reject(new Error('offline')));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await initializeShellUpdate();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('reloads once for a replacement controller', async () => {
    const workers = setup(async () => ({ update: async () => {} }));
    await initializeShellUpdate();
    workers.controller = {};
    workers.dispatchEvent(new Event('controllerchange'));
    workers.dispatchEvent(new Event('controllerchange'));
    expect(location.reload).toHaveBeenCalledTimes(1);
  });
});
