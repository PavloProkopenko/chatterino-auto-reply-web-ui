import type { LuaSources } from './host.ts';

export type Request =
  | { id: number; kind: 'init'; sources: LuaSources }
  | { id: number; kind: 'call'; module: string; fn: string; args: unknown[] }
  | { id: number; kind: 'sanitise'; raw: string };

export type Response = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };

/** Minimal message port both a Web Worker and a Node worker_thread can be adapted to. */
export interface Port {
  postMessage(message: unknown): void;
  onMessage(callback: (message: unknown) => void): void;
}
