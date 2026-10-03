/* global self, MessageChannel, setTimeout, clearTimeout */
// Imported by the generated worker; activation follows successful shell precaching.
function currentShell(client) {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => { channel.port1.close(); resolve(false); }, 500);
    channel.port1.onmessage = (message) => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(message.data?.type === 'GTNH_SHELL_READY');
    };
    client.postMessage({ type: 'GTNH_SHELL_PROBE' }, [channel.port2]);
  });
}
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await self.clients.claim();
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Finish activation before probing: a concurrently reloading shell needs its fetch handler.
    setTimeout(() => { void Promise.allSettled(windows.map(async (client) => {
      if (!client.url.startsWith(self.registration.scope)) return;
      if (await currentShell(client)) return;
      const remaining = await self.clients.get(client.id);
      // The old shell may already be reloading from controllerchange. Probe its replacement too.
      if (!remaining || await currentShell(remaining)) return;
      // Do not await navigation inside activation: its fetch waits for activation to finish.
      void remaining.navigate(remaining.url).catch(() => {});
    })); }, 0);
  })());
});
