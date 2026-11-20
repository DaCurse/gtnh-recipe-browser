import { mkdir, readFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { argumentsMap, assertPathMissing, requiredArgument } from '../data-export/lib';
import { resolveRuntime, createLaunchPlan, launchRuntime } from '../data-export/direct-runtime';

const args = argumentsMap(process.argv.slice(2));
const captureNeiHandlers = args.get('nei-handlers') === 'true';
const heap = args.get('xmx') ?? '7G';
if (!/^\d+[mMgG]$/.test(heap)) throw new Error('--xmx must be a JVM memory size such as 5G');
const root = resolve(requiredArgument(args, 'instance'));
const output = resolve(requiredArgument(args, 'output'));
const workspace = resolve('.export-work');
for (const path of [root, output]) {
  const child = relative(workspace, path);
  if (!child || child.startsWith('..') || isAbsolute(child))
    throw new Error('UI export paths must be below .export-work');
}
await assertPathMissing(output, 'UI snapshot output');
await mkdir(dirname(output), { recursive: true });
const runtime = await resolveRuntime({
  root,
  cacheDirectory: resolve(args.get('cache') ?? '.export-work/direct-export-cache/runtime'),
  download: args.get('download') === 'true',
  extractNatives: true,
});
runtime.jvmArgs.push(
  '-Xms1G',
  `-Xmx${heap}`,
  '-XX:+UseG1GC',
  '-Djava.awt.headless=false',
  '-Dorg.lwjgl.opengl.Display.allowSoftwareOpenGL=true',
  '-Dorg.lwjgl.opengl.Display.enableSoftwareOpenGL=true',
  `-Dbrowser.ui.output=${output}`,
  `-Dbrowser.ui.neiHandlers=${captureNeiHandlers}`,
);
const plan = createLaunchPlan(runtime, {
  java: args.get('java') ?? 'java',
  xvfbArgs: ['-a', '--server-args=-screen 0 1280x720x24'],
  timeoutMs: 900_000,
  statusFile: `${output}.launch-status.json`,
});
const status = await launchRuntime(plan, { env: { ...process.env, LIBGL_ALWAYS_SOFTWARE: '1' } });
if (status.state !== 'exited' || status.exitCode !== 0)
  throw new Error(`UI client failed: ${JSON.stringify(status)}`);
const snapshot = JSON.parse(await readFile(output, 'utf8')) as {
  schemaVersion?: number;
  error?: string;
  maps?: unknown[];
  neiHandlers?: Record<string, { label?: string; recipes?: unknown[] }>;
};
if (
  snapshot.schemaVersion !== 1 ||
  snapshot.error ||
  !Array.isArray(snapshot.maps) ||
  snapshot.maps.length < 100
) {
  throw new Error(`Incomplete UI snapshot: ${snapshot.error ?? 'missing frontend registry'}`);
}
if (captureNeiHandlers) {
  const handlers = Object.entries(snapshot.neiHandlers ?? {});
  if (
    handlers.length === 0 ||
    handlers.some(([, handler]) => !handler.label || !handler.recipes?.length)
  ) {
    throw new Error('Incomplete NEI handler snapshot');
  }
  for (const [, handler] of handlers) {
    console.log(`${handler.label}: ${handler.recipes!.length} recipes`);
  }
}
console.log(`UI snapshot: ${output}`);
