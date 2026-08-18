import type { IncomingMessage, ServerResponse } from 'node:http';

/** The subset of the DSH host that this plugin touches. Mirrors dsh-market. */
export interface WebServerService {
  register(route: {
    kind: 'exact' | 'prefix';
    path: string;
    handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>;
  }): () => void;
}

export interface DshworkHost {
  webServer: WebServerService;
  loader: { entries(): Iterable<unknown> };
  plugin(plugin: unknown, config: unknown): { await(): Promise<unknown>; dispose(): Promise<unknown> | void };
  effect(callback: () => (() => void | Promise<void>), label: string): void;
  logger?: { info?(message: string): void; warn(message: string): void };
}
