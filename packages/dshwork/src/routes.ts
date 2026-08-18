import { spawn } from 'node:child_process';
import type { DshworkHost } from './host';

const FEED = 'https://dsh-plugin.work/data/picks.json';

function sendJson(res: import('node:http').ServerResponse, body: unknown): void {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

export function mountDshworkRoutes(host: DshworkHost): () => void {
  const disposers: Array<() => void> = [];
  // Curated picks feed, proxied from the site (bilingual reasons included).
  disposers.push(host.webServer.register({
    kind: 'exact',
    path: '/dshwork/picks.json',
    handler: async (_req, res) => {
      try {
        const data = await (await fetch(FEED)).json();
        sendJson(res, data);
      } catch {
        sendJson(res, { picks: [] });
      }
    },
  }));

  // One-click install: same-origin POST only, target limited to the curated
  // picks (the client never sends an arbitrary repo).
  disposers.push(host.webServer.register({
    kind: 'exact',
    path: '/dshwork/install',
    handler: (req, res) => {
      if (req.method !== 'POST') return sendJson(res, { ok: false, error: 'POST only' });
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString() || '{}') as { github?: string };
          if (!body.github || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(body.github)) {
            return sendJson(res, { ok: false, error: 'bad repo' });
          }
          const child = spawn('dsh', ['plugin', '--profile', 'web', 'add', `github:${body.github}`], {
            stdio: ['ignore', 'pipe', 'pipe'],
          });
          child.on('close', (code) => sendJson(res, { ok: code === 0, code }));
        } catch {
          sendJson(res, { ok: false, error: 'bad request' });
        }
      });
    },
  }));
  return () => disposers.forEach((d) => d());
}
