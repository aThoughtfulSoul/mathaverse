import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Plugin } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { ABORT_REASON, BODY_LIMITS, DEFAULT_BODY_LIMIT } from './server/types'
import { defineConfig } from 'vitest/config'

// Dev port 3010 on the LAN; on the headset `adb reverse tcp:3010 tcp:3010` and open http://localhost:3010
// (localhost is a secure context, so WebXR is allowed). One three.js copy: dedupe it.

/** DEV only: the in-page canvas recorder POSTs a WebM here; written to .local/recordings/. Loopback only. */
function recordingSink(): Plugin {
  const dir = resolve(__dirname, '.local/recordings')
  return {
    name: 'mw-recording-sink',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__mw/recording', (req, res) => {
        const ip = req.socket.remoteAddress ?? ''
        const loopback = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1'
        if (req.method !== 'POST' || !loopback) {
          res.statusCode = loopback ? 405 : 403
          res.end()
          return
        }
        const chunks: Buffer[] = []
        let size = 0
        req.on('data', (c: Buffer) => {
          size += c.length
          if (size > 80_000_000) req.destroy()
          else chunks.push(c)
        })
        req.on('end', () => {
          const name = String(req.headers['x-mw-name'] ?? 'capture').replace(/[^A-Za-z0-9-]/g, '').slice(0, 40) || 'capture'
          mkdirSync(dir, { recursive: true })
          const file = join(dir, `${name}-${new Date().toISOString().replace(/[:.]/g, '-')}.webm`)
          writeFileSync(file, Buffer.concat(chunks))
          res.statusCode = 200
          res.end(file)
        })
      })
    },
  }
}

/**
 * Application API (WORKSPACE-AND-AI W6) on the same origin as the frontend: /api/* is handled by
 * server/index.ts, loaded through Vite's SSR loader so browser and server share the TypeScript schema
 * modules. Bodies are limited to 256 KiB (recorded audio for /api/transcribe: 1.5 MiB); a client disconnect or the 45 s application timeout aborts
 * the handler's signal. Provider credentials are read server-side from the environment only.
 */
function apiMount(): Plugin {
  type Loader = (url: string) => Promise<Record<string, unknown>>
  const handler = (load: Loader) => async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!req.url?.startsWith('/api/')) return next()
    const send = (status: number, json: unknown) => {
      if (res.writableEnded) return
      res.statusCode = status
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.setHeader('cache-control', 'no-store')
      res.end(JSON.stringify(json))
    }
    const abort = new AbortController()
    res.on('close', () => { if (!res.writableEnded) abort.abort(new Error(ABORT_REASON.disconnect)) })
    const timer = setTimeout(() => abort.abort(new Error(ABORT_REASON.timeout)), 45_000)
    try {
      let body: unknown
      if (req.method === 'POST') {
        const chunks: Buffer[] = []
        let size = 0
        const limit = BODY_LIMITS[req.url.split('?')[0]!] ?? DEFAULT_BODY_LIMIT
        for await (const c of req as AsyncIterable<Buffer>) {
          size += c.length
          if (size > limit) return send(413, { code: 'too_large', message: `request body above ${Math.round(limit / 1024)} KiB`, retryable: false })
          chunks.push(c)
        }
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        } catch {
          return send(400, { code: 'bad_json', message: 'request body is not JSON', retryable: false })
        }
      }
      const mod = await load('/server/index.ts')
      const handleApi = mod.handleApi as (r: { method: string; path: string; body: unknown; signal: AbortSignal }) => Promise<{ status: number; json: unknown }>
      const result = await handleApi({ method: req.method ?? 'GET', path: req.url.split('?')[0]!, body, signal: abort.signal })
      send(result.status, result.json)
    } catch (err) {
      // Never echo internals (they could carry provider details); the message stays generic.
      console.error('[api]', (err as Error)?.name ?? 'Error')
      send(500, { code: 'internal', message: 'internal server error', retryable: true })
    } finally {
      clearTimeout(timer)
    }
  }
  return {
    name: 'mw-api',
    configureServer(server) {
      server.middlewares.use(handler((url) => server.ssrLoadModule(url)))
    },
    async configurePreviewServer(server) {
      // Production preview: a middleware-mode Vite instance only loads the server modules.
      const { createServer } = await import('vite')
      const loader = await createServer({ configFile: false, root: __dirname, server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'warn' })
      server.middlewares.use(handler((url) => loader.ssrLoadModule(url)))
    },
  }
}

export default defineConfig({
  plugins: [recordingSink(), apiMount()],
  server: { port: 3010, strictPort: true, host: true },
  preview: { port: 3010, strictPort: true, host: true },
  resolve: {
    dedupe: ['three'],
    // manim-web 0.40.1 dist does `await import("pptxgenjs")` inside try/catch (PPTX export); not installed here.
    alias: { pptxgenjs: resolve(__dirname, 'src/runtime/optionalMissing.ts') },
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
})
