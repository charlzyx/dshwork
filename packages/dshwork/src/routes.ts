import { spawn, type ChildProcess } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { DshworkHost } from './host';

const FEED = 'https://dsh-plugin.work/data/picks.json';
const EXPLORE = 'https://dsh-plugin.work/api/v1/plugins';
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;

/** TTL 缓存（picks feed + explore 响应 + 白名单目标）。 */
let cache: { at: number; picks: unknown; explore: Map<string, unknown>; targets: Set<string> | null } = {
  at: 0,
  picks: null,
  explore: new Map(),
  targets: null,
};
function cacheFresh(): boolean {
  return cache.at !== 0 && Date.now() - cache.at < 10 * 60 * 1000;
}

function sendJson(res: import('node:http').ServerResponse, body: unknown): void {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

/**
 * Re-invoke the dsh CLI that launched this host. launchd/GUI hosts do not
 * inherit the shell PATH, so a bare `dsh` (and the pnpm it spawns) dies with
 * ENOENT — re-running `process.argv[1]` works regardless of how dsh started.
 * Falls back to a PATH `dsh` (whose PATH we extend in spawnEnv).
 */
function dshInvocation(): { file: string; args: string[]; cwd?: string } {
  const entry = process.argv[1];
  if (entry !== undefined && /[\\/](?:bin\.(?:js|ts)|dsh)$/.test(entry)) {
    const abs = resolve(entry);
    return { file: process.execPath, args: [...process.execArgv, abs], cwd: dirname(abs) };
  }
  return { file: 'dsh', args: [] };
}

/**
 * pnpm v10+ blocks forever on a silent interactive prompt without a TTY;
 * CI mode forces it to act or fail. PATH is extended with the usual bin dirs
 * so `dsh` and `pnpm` resolve even under launchd/GUI.
 */
function spawnEnv(): NodeJS.ProcessEnv {
  const separator = process.platform === 'win32' ? ';' : ':';
  const parts = (process.env.PATH ?? '').split(separator).filter((part) => part !== '');
  const candidates = [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    join(homedir(), '.local', 'bin'),
    dirname(process.execPath),
  ];
  for (const bin of candidates) {
    if (!parts.includes(bin)) parts.push(bin);
  }
  return { ...process.env, CI: 'true', PATH: parts.join(separator) };
}

/** Kill the child and its whole process group (the dsh wrapper spawns pnpm as a grandchild). */
function killTree(child: ChildProcess): void {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      /* already gone */
    }
  }
}

/** Run `dsh plugin add` and answer the request once the child settles. */
function runInstall(target: string, res: import('node:http').ServerResponse): void {
  const { file, args, cwd } = dshInvocation();
  const child = spawn(file, [...args, 'plugin', '--profile', 'web', 'add', target], {
    cwd,
    env: spawnEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  let stdout = '';
  let stderr = '';
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    killTree(child);
  }, INSTALL_TIMEOUT_MS);
  child.stdout?.on('data', (chunk: Buffer) => {
    stdout = (stdout + chunk.toString()).slice(-64 * 1024);
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-32 * 1024);
  });
  child.on('error', (error) => {
    clearTimeout(timer);
    sendJson(res, { ok: false, code: 127, error: `cannot start dsh: ${error.message}` });
  });
  child.on('close', (code) => {
    clearTimeout(timer);
    const failed = code !== 0 || timedOut;
    sendJson(res, failed
      ? { ok: false, code, ...(timedOut ? { error: 'timed out' } : { error: (stderr || stdout).trim().slice(-400) || 'install failed' }) }
      : { ok: true, code });
  });
}

/** 从安装命令提取 target：兼容 `dsh plugin add X` 与 `dsh plugin --profile web add X`。 */
function installTarget(install: string): string {
  return install.replace(/^dsh plugin(?:\s+--profile\s+\S+)?\s+add\s+/, '').trim();
}

/** Install targets of the curated picks feed (e.g. `github:owner/repo` or `@scope/name`). Cached 10 min. */
async function allowedTargets(): Promise<Set<string>> {
  if (cache.targets !== null && cacheFresh()) return cache.targets;
  const set = new Set<string>();
  try {
    const picks = (await (await fetch(FEED)).json()) as { picks?: Array<{ install: string }> };
    for (const pick of picks.picks ?? []) set.add(installTarget(pick.install));
  } catch { /* ignore */ }
  try {
    for (let offset = 0; offset < 1000; offset += 100) {
      const data = (await (await fetch(`${EXPLORE}?sort=stars&min_stars=100&limit=100&offset=${offset}`)).json()) as {
        data?: Array<{ installCommand: string | null }>;
      };
      const items = data.data ?? [];
      for (const item of items) {
        if (item.installCommand) set.add(installTarget(item.installCommand));
      }
      if (items.length < 100) break;
    }
  } catch { /* ignore */ }
  cache.targets = set;
  cache.at = Date.now();
  return set;
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

  // Popular explore feed, proxied from the site API (stars >= 100, optional
  // kind filter, paginated). Server-side proxy avoids browser CORS.
  disposers.push(host.webServer.register({
    kind: 'exact',
    path: '/dshwork/explore',
    handler: async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://x');
      const params = new URLSearchParams({
        sort: 'stars',
        min_stars: '100',
      });
      for (const key of ['kind', 'limit', 'offset']) {
        const value = url.searchParams.get(key);
        if (value) params.set(key, value);
      }
      const key = params.toString();
      if (cache.explore.has(key) && cacheFresh()) {
        return sendJson(res, cache.explore.get(key));
      }
      try {
        const data = await (await fetch(`${EXPLORE}?${key}`)).json();
        cache.explore.set(key, data);
        cache.at = Date.now();
        sendJson(res, data);
      } catch {
        sendJson(res, { data: [], page: { offset: 0, limit: 0, total: 0, has_more: false } });
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
          runInstall(target, res);
        } catch {
          sendJson(res, { ok: false, error: 'bad request' });
        }
      });
    },
  }));
  return () => disposers.forEach((d) => d());
}
