/// <reference lib="webworker" />
import { decode } from '@msgpack/msgpack';
import { RecipeChainGraph, validateChainGraph } from '../lib/recipeChain';

let graph: RecipeChainGraph | undefined;
let generation = 0;
let pending: AbortController | undefined;
self.onmessage = (event: MessageEvent<
  | { type: 'init'; datasetId: string; manifestSha256: string; bytes: ArrayBuffer }
  | { type: 'search'; id: number; inputs: string[]; outputs: string[]; maxDepth: number; allowExtras: boolean; routeLimit?: number }
  | { type: 'cancel' }
>) => {
  const request = event.data;
  pending?.abort();
  const current = ++generation;
  if (request.type === 'cancel') return;
  if (request.type === 'init') {
    graph = undefined;
    void (async () => {
      const stream = new Blob([request.bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      const raw = new Uint8Array(await new Response(stream).arrayBuffer());
      const value = validateChainGraph(decode(raw), request.datasetId, request.manifestSha256);
      if (current !== generation) return;
      graph = new RecipeChainGraph(value);
      self.postMessage({ type: 'ready', recipes: value.recipes.length });
    })().catch((error: unknown) => {
      if (current === generation) self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    });
    return;
  }
  if (!graph) return;
  const controller = new AbortController(); pending = controller;
  void graph.search(request.inputs, request.outputs, request, controller.signal, (progress) => {
    if (current === generation) self.postMessage({ type: 'progress', id: request.id, ...progress });
  }).then((paths) => {
    if (current === generation) self.postMessage({ type: 'results', id: request.id, paths });
  }).catch((error: unknown) => {
    if (current === generation) self.postMessage({ type: 'error', id: request.id, message: error instanceof Error ? error.message : String(error) });
  });
};
