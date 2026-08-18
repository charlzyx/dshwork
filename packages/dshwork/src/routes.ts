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
  // picks feed. The client only ever sends a target it saw in the feed, but
  // the server re-checks against the live feed so a compromised settings page
  // cannot make dsh run an arbitrary install command.
  disposers.push(host.webServer.register({
    kind: 'exact',
    path: '/dshwork/install',
    handler: (req, res) => {
      if (req.method !== 'POST') return sendJson(res, { ok: false, error: 'POST only' });
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', async () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString() || '{}') as { target?: string };
          const target = body.target?.trim();
          if (!target) return sendJson(res, { ok: false, error: 'missing target' });
          const allowed = await allowedTargets();
          if (!allowed.has(target)) return sendJson(res, { ok: false, error: 'target not allowed' });
          const child = spawn('dsh', ['plugin', '--profile', 'web', 'add', target], {
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

/** Install targets of the curated picks feed (e.g. `github:owner/repo` or `@scope/name`). */
async function allowedTargets(): Promise<Set<string>> {
  try {
    const data = (await (await fetch(FEED)).json()) as { picks?: Array<{ install: string }> };
    return new Set((data.picks ?? []).map((pick) => pick.install.replace(/^dsh plugin add\s+/, '')));
  } catch {
    return new Set();
  }
}
