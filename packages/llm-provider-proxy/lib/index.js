/**
 * @dshwork/llm-provider-proxy — generic per-provider HTTP proxy for the
 * DeepSeek Harness.
 *
 * Owns the whole transport-proxy layer: a zero-dependency HTTP CONNECT
 * tunnel (Node's global fetch ignores `http_proxy`/`https_proxy` env vars,
 * and some provider endpoints are region-blocked), plus a global fetch
 * wrapper that routes each request through a proxy when its host belongs to
 * a configured provider route. Only listed providers are proxied; everything
 * else passes through untouched — this is not a global proxy.
 *
 * Settings section (hot-reloadable, `$DSH_HOME/settings.yaml`):
 *
 * ```yaml
 * dsh-provider-proxy:
 *   proxy: http://127.0.0.1:7897        # one HTTP proxy (Clash/ClashX/...)
 *   providers:
 *     - openai-codex
 *     - anthropic
 * ```
 *
 * Bundle: `dsh.bundle.patch` auto-mounts this package on `dsh plugin add`.
 *
 * Host → provider resolution: a built-in table for known providers
 * (openai-codex → chatgpt.com/auth.openai.com, deepseek-official →
 * api.deepseek.com, ...) plus baseURL hosts read from the `llm-pi-ai` /
 * `llm-deepseek` settings sections (covers custom gateways). Loopback hosts
 * are never proxied.
 */

import http from 'node:http'
import https from 'node:https'
import tls from 'node:tls'
import { Readable } from 'node:stream'
import { URL } from 'node:url'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'

export const name = 'dsh-provider-proxy'
export const inject = ['settings']

const NS = settingsNamespace('dsh-provider-proxy')

/** Settings schema: one proxy URL and the provider routes it applies to. */
const Config = z.object({
  proxy: z.string(),
  providers: z.array(z.string()).default([]),
})

/** Known provider → request hosts, used when no settings section names one. */
const BUILTIN_HOSTS = {
  'openai-codex': ['chatgpt.com', 'auth.openai.com'],
  'deepseek-official': ['api.deepseek.com'],
  anthropic: ['api.anthropic.com'],
  openai: ['api.openai.com'],
  openrouter: ['openrouter.ai'],
  google: ['generativelanguage.googleapis.com'],
}

//#region CONNECT tunnel

/** Parse and validate one proxy URL value; undefined when empty. */
export function parseProxyUrl(value) {
  if (value === undefined || value === null) return undefined
  const text = String(value).trim()
  if (!text) return undefined
  const url = new URL(text)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`dsh-provider-proxy: unsupported proxy scheme "${url.protocol}" in "${text}"; use an HTTP proxy (e.g. Clash/ClashX)`)
  }
  return url
}

/** Loopback hosts are never proxied: proxying them is never useful and would
 * intercept a process's own local traffic. */
export function isLoopbackHost(hostname) {
  return hostname === 'localhost' || hostname === '[::1]' || hostname === '::1' || /^127(?:\.\d{1,3}){3}$/.test(hostname)
}

/** Normalize any fetch input to a URL object. */
function urlOf(input) {
  if (input instanceof URL) return input
  if (typeof input === 'string') return new URL(input)
  if (input instanceof Request) return new URL(input.url)
  return new URL(String(input))
}

/** The real platform fetch captured at module load, so wrapper fallbacks
 * never recurse into another wrapper installed later. */
const NATIVE_FETCH = globalThis.fetch

class ConnectProxyAgent extends https.Agent {
  constructor(proxy) {
    super()
    this.proxy = proxy
  }
  createConnection(options, callback) {
    const proxy = this.proxy
    const connectPath = `${options.host}:${options.port}`
    const headers = { Host: connectPath, 'Proxy-Connection': 'keep-alive' }
    if (proxy.username || proxy.password) {
      const credentials = Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString('base64')
      headers['Proxy-Authorization'] = `Basic ${credentials}`
    }
    const request = http.request({
      host: proxy.hostname,
      port: proxy.port || 80,
      method: 'CONNECT',
      path: connectPath,
      headers,
    })
    request.on('connect', (response, socket) => {
      if (response.statusCode !== 200) {
        socket.destroy()
        callback(new Error(`proxy CONNECT failed: ${response.statusCode} ${response.statusMessage || ''}`))
        return
      }
      const tlsSocket = tls.connect({ socket, servername: options.host })
      tlsSocket.once('secureConnect', () => callback(null, tlsSocket))
      tlsSocket.once('error', (error) => callback(error))
    })
    request.on('error', (error) => callback(error))
    request.end()
  }
}

/**
 * fetch-compatible transport that routes through an HTTP proxy. Falls back
 * to the native fetch when no proxy applies (none configured, non-https
 * target, or loopback host).
 */
export async function proxiedFetch(input, init = {}, explicitProxy) {
  const proxy = explicitProxy !== undefined ? parseProxyUrl(explicitProxy) : undefined
  const url = urlOf(input)
  if (!proxy || url.protocol !== 'https:' || isLoopbackHost(url.hostname)) {
    return NATIVE_FETCH(input, init)
  }
  const method = init.method ?? 'GET'
  const headers = new Headers(init.headers)
  const plainHeaders = {}
  for (const [name, value] of headers.entries()) plainHeaders[name] = value
  let bodyBuffer
  if (init.body !== undefined && init.body !== null) {
    const body = init.body
    if (typeof body === 'string') {
      bodyBuffer = Buffer.from(body)
    } else if (body instanceof Uint8Array) {
      bodyBuffer = Buffer.from(body)
    } else if (body instanceof ArrayBuffer) {
      bodyBuffer = Buffer.from(body)
    } else if (typeof body[Symbol.asyncIterator] === 'function') {
      const chunks = []
      for await (const chunk of body) chunks.push(Buffer.from(chunk))
      bodyBuffer = Buffer.concat(chunks)
    } else {
      bodyBuffer = Buffer.from(String(body))
    }
  }
  const agent = new ConnectProxyAgent(proxy)
  const response = await new Promise((resolve, reject) => {
    const request = https.request(
      {
        host: url.hostname,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method,
        headers: {
          ...plainHeaders,
          ...bodyBuffer !== undefined ? { 'Content-Length': bodyBuffer.byteLength } : {},
        },
        agent,
        signal: init.signal,
      },
      (res) => {
        resolve(new Response(Readable.toWeb(res), {
          status: res.statusCode ?? 200,
          statusText: res.statusMessage,
          headers: new Headers(res.headers),
        }))
      }
    )
    request.on('error', (error) => reject(error))
    if (bodyBuffer !== undefined) request.write(bodyBuffer)
    request.end()
  })
  return response
}

//#endregion

//#region Host routing

/** Hosts a configured route owns, read from the owning settings section. */
function settingsHosts(ctx, provider) {
  const out = []
  const pi = ctx.settings.get('llm-pi-ai')
  const piBase = pi?.providers?.[provider]?.baseURL
  if (typeof piBase === 'string' && piBase) {
    try {
      out.push(new URL(piBase).hostname)
    } catch {
      /* unparseable baseURL — ignore */
    }
  }
  if (provider === 'deepseek-official') {
    const ds = ctx.settings.get('llm-deepseek')
    if (typeof ds?.baseURL === 'string' && ds.baseURL) {
      try {
        out.push(new URL(ds.baseURL).hostname)
      } catch {
        /* unparseable baseURL — ignore */
      }
    }
  }
  return out
}

/** Build the host → proxyUrl index for the current section value. */
function buildIndex(ctx, section) {
  const index = new Map()
  const proxy = section?.proxy
  if (!proxy) return index
  const providers = section?.providers ?? []
  for (const provider of providers) {
    const hosts = [...(BUILTIN_HOSTS[provider] ?? [])]
    for (const host of settingsHosts(ctx, provider)) {
      if (!hosts.includes(host)) hosts.push(host)
    }
    for (const host of hosts) {
      if (!isLoopbackHost(host)) index.set(host, proxy)
    }
  }
  return index
}

//#endregion

export function apply(ctx, config) {
  let current = () => config
  const originalFetch = globalThis.fetch
  let disposed = false
  globalThis.fetch = (input, init) => {
    if (disposed) return originalFetch(input, init)
    let hostname = ''
    try {
      hostname = input instanceof URL ? input.hostname : new URL(String(input.url ?? input)).hostname
    } catch {
      return originalFetch(input, init)
    }
    if (isLoopbackHost(hostname)) return originalFetch(input, init)
    const proxy = buildIndex(ctx, current()).get(hostname)
    if (proxy) return proxiedFetch(input, init, proxy)
    return originalFetch(input, init)
  }
  ctx.on('dispose', () => {
    disposed = true
    globalThis.fetch = originalFetch
  })
  installSettingsSection(ctx, NS, Config, config, {
    setSource: (source) => {
      current = source
    },
    onChange: () => {},
  })
  ctx.logger?.info?.('dsh-provider-proxy: per-provider proxy wrapper installed (configure the dsh-provider-proxy settings section)')
}
