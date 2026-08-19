import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
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

interface RunResult {
  exitCode: number;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}

/** Run one `dsh plugin --profile web <args…>` command, capturing output with timeout + group kill. */
function runOp(pluginArgs: string[]): Promise<RunResult> {
  const { file, args, cwd } = dshInvocation();
  return new Promise((resolvePromise) => {
    const child = spawn(file, [...args, 'plugin', '--profile', 'web', ...pluginArgs], {
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
      stdout = (stdout + chunk.toString()).slice(-256 * 1024);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-64 * 1024);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolvePromise({ exitCode: 127, timedOut: false, stdout, stderr: `${stderr}\n${error.message}` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolvePromise({ exitCode: code ?? 1, timedOut, stdout, stderr });
    });
  });
}

/** pnpm 9 refuses `add` at a workspace root without -w; inject it when the profile is one. */
function pluginArgsFor(verb: string, target: string): string[] {
  const profileDir = join(homedir(), '.dsh', 'profiles', 'web');
  const args = [verb, target];
  if ((verb === 'add' || verb === 'remove') && existsSync(join(profileDir, 'pnpm-workspace.yaml'))) {
    args.splice(1, 0, '-w');
  }
  return args;
}

interface Failure { code: string; message: string }

/**
 * Map pnpm's raw diagnostics onto a recoverable mode + a bilingual actionable
 * message. Mirrors dshmarket's `classifyPnpmFailure`: dsh's own wrapper line
 * ("dsh: pnpm failed in profile directory …") names no cause, so we recognize
 * pnpm's real diagnostics ourselves.
 */
function classifyFailure(output: string): Failure | null {
  if (output.includes('ERR_PNPM_PUBLIC_HOIST_PATTERN_DIFF')) {
    return { code: 'hoist-pattern', message: 'profile 的 node_modules 是旧版 pnpm 创建的，与当前 pnpm 不兼容，需重建后重试 / the profile node_modules was built by a different pnpm major and must be rebuilt before changes apply' };
  }
  if (output.includes('ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION') || output.includes('ERR_PNPM_NO_MATURE_MATCHING_VERSION')) {
    return { code: 'release-age', message: 'profile 里有刚发布不久的插件版本，触发了 pnpm 的安全等待期检查；已自动放行重试一次，若仍失败请稍后再试 / a recently published plugin version trips pnpm`s fresh-release check; retried once with a one-shot bypass' };
  }
  if (output.includes('ERR_PNPM_IGNORED_BUILDS') || output.includes('ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED')) {
    return { code: 'build-blocked', message: '有依赖需要执行构建脚本，被 pnpm 默认拦截，需在 allowBuilds 放行后重试 / a dependency needs build scripts that pnpm blocks by default; allow it under allowBuilds and retry' };
  }
  if (output.includes('ERR_PNPM_FETCH_404')) {
    return { code: 'fetch-404', message: '有依赖在 registry 上不存在（可能是之前失败操作残留的幽灵依赖，或私有包需登录）/ a dependency cannot be resolved (ghost entry from an earlier failed step, or a private package needing credentials)' };
  }
  if (/ERR_PNPM_FETCH_5\d\d|ERR_PNPM_META_FETCH_FAIL|FetchError|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|socket hang up|network timeout/i.test(output)) {
    return { code: 'transient-network', message: '拉取依赖时网络临时失败（安装会重放整个依赖树，任一既有依赖抖动都会中断）；已自动重试一次，仍失败请稍后再试 / a transient network failure during dependency fetch; one automatic retry also failed — try again shortly' };
  }
  if (/operation was aborted due to timeout|TimeoutError|error \(23\)/i.test(output)) {
    return { code: 'fetch-timeout', message: '下载超时（github 源会下载整个仓库或网络较慢）；已用更长超时自动重试一次 / download timed out (github sources fetch the whole repo / slow network); retried once with a longer limit' };
  }
  if (output.includes('pnpm not found on PATH')) {
    return { code: 'pnpm-missing', message: '找不到 pnpm / pnpm is not on PATH' };
  }
  return null;
}

/** Run the install with automatic recovery for the known pnpm traps (mirrors dshmarket's withHoistRecovery). */
async function runInstallAsync(target: string): Promise<{ ok: boolean; code?: number; error?: string }> {
  const addArgs = pluginArgsFor('add', target);
  const ok = (r: RunResult): boolean => r.exitCode === 0 && !r.timedOut;
  let result = await runOp(addArgs);
  if (!ok(result)) {
    const failure = classifyFailure(`${result.stderr}\n${result.stdout}`);
    if (failure?.code === 'release-age') {
      result = await runOp([...addArgs, '--config.minimumReleaseAge=0']);
    } else if (failure?.code === 'transient-network') {
      result = await runOp(addArgs);
    } else if (failure?.code === 'fetch-timeout') {
      result = await runOp([...addArgs, '--config.fetchTimeout=600000']);
    } else if (failure?.code === 'hoist-pattern') {
      await runOp(['install', '--no-frozen-lockfile']);
      result = await runOp(addArgs);
    }
    if (!ok(result)) {
      const finalFailure = classifyFailure(`${result.stderr}\n${result.stdout}`);
      const raw = (result.stderr || result.stdout).trim().slice(-300);
      return {
        ok: false,
        code: result.exitCode,
        error: result.timedOut ? 'timed out' : (finalFailure?.message ?? raw ?? 'install failed'),
      };
    }
  }
  return { ok: true, code: result.exitCode };
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
      for (const key of ['q', 'kind', 'limit', 'offset', 'exclude_other']) {
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
          const result = await runInstallAsync(target);
          sendJson(res, result);
        } catch {
          sendJson(res, { ok: false, error: 'bad request' });
        }
      });
    },
  }));
  return () => disposers.forEach((d) => d());
}
