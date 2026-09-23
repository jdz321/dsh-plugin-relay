/**
 * Minimal HTTP(S) client for the relay API with optional outbound proxy
 * support (CONNECT tunneling), so requests work both direct and behind a
 * local HTTP proxy.
 */

import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import tls from 'node:tls'
import { URL } from 'node:url'

export class HttpError extends Error {
  status: number
  body: string
  detail: string

  constructor(status: number, body: string, url: string) {
    let detail = ''
    try {
      const parsed = JSON.parse(body) as { message?: string; error?: { message?: string } }
      detail = parsed?.message ?? parsed?.error?.message ?? ''
    } catch {
      detail = body?.slice(0, 200) ?? ''
    }
    super(`HTTP ${status} from ${url}${detail ? `: ${detail}` : ''}`)
    this.name = 'HttpError'
    this.status = status
    this.body = body
    this.detail = detail
  }
}

function connectViaProxy(proxyUrl: string, targetHost: string, targetPort: number, timeoutMs: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const proxy = new URL(proxyUrl)
    const socket = net.connect({
      host: proxy.hostname,
      port: Number(proxy.port || (proxy.protocol === 'https:' ? 443 : 80)),
    })
    const fail = (err: Error) => {
      socket.destroy()
      reject(new Error(`proxy CONNECT failed for ${targetHost}:${targetPort} via ${proxyUrl}: ${err.message}`))
    }
    socket.setTimeout(timeoutMs, () => fail(new Error('timeout')))
    socket.once('error', fail)
    socket.once('connect', () => {
      socket.write(
        `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\n` +
        `Host: ${targetHost}:${targetPort}\r\n` +
        'Proxy-Connection: keep-alive\r\n\r\n',
      )
    })
    let head = ''
    const onData = (chunk: Buffer) => {
      head += chunk.toString('latin1')
      if (!head.includes('\r\n\r\n')) return
      socket.removeListener('data', onData)
      const statusLine = head.split('\r\n')[0] ?? ''
      const statusCode = Number(statusLine.split(' ')[1])
      if (statusCode !== 200) {
        fail(new Error(`proxy answered ${statusLine}`))
        return
      }
      socket.pause()
      resolve(socket)
    }
    socket.on('data', onData)
  })
}

function collectResponse(res: http.IncomingMessage): Promise<{ status: number | undefined, text: string }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    res.on('data', (c: Buffer) => chunks.push(c))
    res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }))
    res.on('error', reject)
  })
}

export interface RequestOptions {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: string
  timeoutMs?: number
  /** http(s) proxy URL for a CONNECT tunnel, or null to disable. */
  proxy?: string | null
}

/** Perform one HTTP(S) request and return { status, text }. */
export async function request({ url, method = 'GET', headers = {}, body, timeoutMs = 20000, proxy = null }: RequestOptions): Promise<{ status: number | undefined, text: string }> {
  const target = new URL(url)
  const isHttps = target.protocol === 'https:'
  const port = Number(target.port || (isHttps ? 443 : 80))

  if (proxy && !isHttps) {
    // Plain HTTP through a proxy: absolute-form request target.
    return new Promise((resolve, reject) => {
      const p = new URL(proxy)
      const req = http.request(
        {
          host: p.hostname,
          port: Number(p.port || 80),
          path: target.href,
          method,
          headers: { ...headers, host: target.host, ...(body !== undefined ? { 'content-length': Buffer.byteLength(body) } : {}) },
          timeout: timeoutMs,
        },
        (res) => collectResponse(res).then(resolve, reject),
      )
      req.setTimeout(timeoutMs, () => req.destroy(new Error(`timeout after ${timeoutMs}ms`)))
      req.once('error', reject)
      req.end(body)
    })
  }

  const runRequest = (createConnection?: () => tls.TLSSocket) =>
    new Promise<{ status: number | undefined, text: string }>((resolve, reject) => {
      const lib = isHttps ? https : http
      const reqOptions: https.RequestOptions = {
        host: target.hostname,
        port,
        path: `${target.pathname}${target.search}`,
        method,
        headers: { ...headers, ...(body !== undefined ? { 'content-length': Buffer.byteLength(body) } : {}) },
        timeout: timeoutMs,
      }
      if (createConnection) reqOptions.createConnection = createConnection
      const req = lib.request(reqOptions, (res) => collectResponse(res).then(resolve, reject))
      req.setTimeout(timeoutMs, () => req.destroy(new Error(`timeout after ${timeoutMs}ms`)))
      req.once('error', reject)
      req.end(body)
    })

  if (proxy && isHttps) {
    // Establish CONNECT + TLS first, then issue the request over the socket
    // synchronously (http.request's createConnection is callback-style).
    const raw = await connectViaProxy(proxy, target.hostname, port, timeoutMs)
    const tlsSocket = tls.connect({ socket: raw, servername: target.hostname })
    return runRequest(() => tlsSocket)
  }
  return runRequest()
}

/** request() + JSON parse + non-2xx HttpError. */
export async function requestJson(opts: RequestOptions): Promise<unknown> {
  const { status, text } = await request(opts)
  if ((status ?? 0) < 200 || (status ?? 0) >= 300) throw new HttpError(status ?? 0, text, opts.url)
  try {
    return JSON.parse(text)
  } catch (err) {
    throw new Error(`invalid JSON from ${opts.url}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/** The outbound proxy from the environment, when one is configured. */
export function envProxy(): string | null {
  return process.env.https_proxy ?? process.env.HTTPS_PROXY ?? process.env.http_proxy ?? process.env.HTTP_PROXY ?? null
}
