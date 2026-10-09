/** Register before dataset startup; an unreachable update server cannot block browsing. */
export async function initializeShellUpdate(timeoutMs = 150): Promise<void> {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  const workers = navigator.serviceWorker;
  let reloading = false;
  const initialController = workers.controller;
  const announce = (worker: ServiceWorker | null) => {
    if (!worker || worker.state === 'redundant') return;
    try {
      worker.postMessage({ type: 'GTNH_SHELL_READY', revision: __SHELL_REVISION__ });
    } catch {
      // A worker can become redundant between inspection and announcement.
    }
  };
  announce(initialController);
  const reload = () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  };
  workers.addEventListener('message', (event: MessageEvent) => {
    if (event.data?.type === 'GTNH_SHELL_PROBE') {
      event.ports[0]?.postMessage({ type: 'GTNH_SHELL_READY', revision: __SHELL_REVISION__ });
    }
  });
  workers.addEventListener('controllerchange', () => {
    if (initialController && workers.controller !== initialController) reload();
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const update = async () => {
    const registration = await workers.register(new URL('sw.js', document.baseURI), { updateViaCache: 'none' });
    if (!registration) return;
    // Announce before catalog work can occupy the main thread. A freshly installed
    // worker must not mistake a busy current shell for an unresponsive legacy client.
    const announceRegistration = () => {
      announce(registration.installing);
      announce(registration.waiting);
      announce(registration.active);
    };
    announceRegistration();
    registration.addEventListener('updatefound', announceRegistration);
    const activate = async (worker: ServiceWorker) => {
      announce(worker);
      worker.postMessage({ type: 'SKIP_WAITING' });
      if (worker.state === 'activated' || worker.state === 'redundant') return;
      await new Promise<void>((resolve) => {
        worker.addEventListener('statechange', () => {
          if (worker.state === 'activated' || worker.state === 'redundant') resolve();
        });
      });
    };
    if (registration.waiting) await activate(registration.waiting);
    await registration.update();
    announceRegistration();
    if (registration.installing) await activate(registration.installing);
    if (registration.waiting) await activate(registration.waiting);
  };
  try {
    await Promise.race([update(), new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    })]);
  } catch (error) {
    console.warn('Service worker update unavailable', error);
  } finally {
    clearTimeout(timer);
  }
}
