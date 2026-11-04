#!/usr/bin/env node
// Continuous recordings of the real page (DOM shell + WebGL canvas) with headless Chrome, driven over CDP.
// Same steps as scripts/shot.mjs, plus a screencast: frames are captured as the compositor produces them,
// with their real timestamps, and encoded once at the end with ffmpeg (variable frame timing preserved, so
// waits are not sped up). Desktop evidence (D) only: this is not the WebXR emulator or a headset.
//
//   node --experimental-websocket scripts/proof-record.mjs --url 'http://localhost:3013/' --size 1600x1000 \
//     --wait '<js>' --record-start docs/evidence/proof-explorer/x.mp4 --eval '<js>' --sleep 2000 --record-stop
//
// Steps (in order): --wait '<js truthy>' (up to 30 s)  --eval '<js>' (awaited; result printed)  --sleep <ms>
//   --click <x>,<y>  --shot <file.png>  --record-start <file.mp4>  --record-stop  --mark '<label>' (printed with
//   the elapsed recording time, for the evidence log)

import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync, mkdtempSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const args = process.argv.slice(2)
const opt = (name, dflt) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : dflt
}
const url = opt('--url')
if (!url) {
  console.error('usage: proof-record.mjs --url <u> [--size WxH] steps...')
  process.exit(2)
}
const [W, H] = opt('--size', '1600x1000').split('x').map(Number)
const port = 9300 + Math.floor(Math.random() * 600)
const profile = resolve('.local/chrome-shot', `rec-${port}`)
mkdirSync(profile, { recursive: true })

// CHROME_EXTRA_ARGS: extra space-separated Chrome flags, e.g. a fake microphone fed from a WAV file
// (--use-fake-device-for-media-stream --use-file-for-fake-audio-capture=<file>), used by scripts/voice-chain.sh.
const extra = (process.env.CHROME_EXTRA_ARGS ?? '').split(/\s+/).filter(Boolean)
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--use-angle=metal', '--enable-webgl', '--ignore-gpu-blocklist',
  '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--mute-audio', `--window-size=${W},${H}`, ...extra, 'about:blank',
], { stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let ws
let seq = 0
const pending = new Map()
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const id = ++seq
    pending.set(id, { res, rej })
    ws.send(JSON.stringify({ id, method, params }))
  })

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression: `(async () => { const v = await (${expression}); try { return JSON.stringify(v) } catch { return String(v) } })()`, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(`eval failed: ${JSON.stringify(r.exceptionDetails).slice(0, 600)}`)
  return r.result?.value
}

/** The current recording: frames with their compositor timestamps (seconds). */
let rec = null

async function stopRecording() {
  if (!rec) return
  await send('Page.stopScreencast')
  const { file, frames, t0 } = rec
  rec = null
  if (frames.length < 2) throw new Error('recording captured fewer than two frames')
  const dir = mkdtempSync(join(tmpdir(), 'mw-rec-'))
  try {
    const lines = []
    frames.forEach((f, i) => {
      const name = `f${String(i).padStart(6, '0')}.jpg`
      writeFileSync(join(dir, name), Buffer.from(f.data, 'base64'))
      const next = frames[i + 1]
      lines.push(`file '${name}'`, `duration ${Math.max(0.001, (next ? next.t : f.t + 0.04) - f.t).toFixed(4)}`)
    })
    lines.push(`file 'f${String(frames.length - 1).padStart(6, '0')}.jpg'`)
    writeFileSync(join(dir, 'list.txt'), lines.join('\n'))
    mkdirSync(dirname(resolve(file)), { recursive: true })
    const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(dir, 'list.txt'), '-vf', 'fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', resolve(file)], { stdio: 'inherit' })
    if (r.status !== 0) throw new Error('ffmpeg failed')
    console.log(`wrote ${file} (${frames.length} frames, ${(frames[frames.length - 1].t - t0).toFixed(1)} s)`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

async function main() {
  let target = null
  for (let i = 0; i < 100 && !target; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
      target = list.find((t) => t.type === 'page')
    } catch {
      await sleep(100)
    }
  }
  if (!target) throw new Error('Chrome did not start')
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => ((ws.onopen = res), (ws.onerror = rej)))
  ws.onmessage = (m) => {
    const msg = JSON.parse(String(m.data))
    if (msg.method === 'Page.screencastFrame') {
      const { data, sessionId, metadata } = msg.params
      if (rec) rec.frames.push({ data, t: metadata.timestamp })
      void send('Page.screencastFrameAck', { sessionId })
      return
    }
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? p.rej(new Error(JSON.stringify(msg.error))) : p.res(msg.result)
    }
  }
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url })
  await sleep(500)
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    const v = args[i + 1]
    if (a === '--url' || a === '--size') {
      i++
      continue
    }
    if (a === '--wait') {
      const t0 = Date.now()
      while (Date.now() - t0 < 30000) {
        const ok = await evaluate(`!!(${v})`).catch(() => 'false')
        if (ok === 'true') break
        await sleep(200)
      }
      i++
    } else if (a === '--eval') {
      const out = await evaluate(v)
      if (out !== undefined && out !== 'undefined') console.log(out.length <= 4000 ? out : `${out.slice(0, 4000)}…`)
      i++
    } else if (a === '--sleep') {
      await sleep(Number(v))
      i++
    } else if (a === '--click') {
      const [x, y] = v.split(',').map(Number)
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
      await sleep(120)
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
      await sleep(90)
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 })
      i++
    } else if (a === '--shot') {
      const r = await send('Page.captureScreenshot', { format: 'png' })
      mkdirSync(dirname(resolve(v)), { recursive: true })
      writeFileSync(v, Buffer.from(r.data, 'base64'))
      console.log(`wrote ${v}`)
      i++
    } else if (a === '--record-start') {
      rec = { file: v, frames: [], t0: Date.now() / 1000 }
      await send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: W, maxHeight: H, everyNthFrame: 1 })
      await sleep(300)
      if (rec.frames.length) rec.t0 = rec.frames[0].t
      i++
    } else if (a === '--record-stop') {
      await stopRecording()
    } else if (a === '--mark') {
      const t = rec && rec.frames.length ? (rec.frames[rec.frames.length - 1].t - rec.frames[0].t).toFixed(1) : '-'
      console.log(`[${t} s] ${v}`)
      i++
    }
  }
  await stopRecording()
}

try {
  await main()
} catch (e) {
  console.error(String(e))
  process.exitCode = 1
} finally {
  try { ws?.close() } catch {}
  chrome.kill('SIGKILL')
  await sleep(200)
  rmSync(profile, { recursive: true, force: true })
}
