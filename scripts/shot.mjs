#!/usr/bin/env node
// Desktop captures of the real WebGL scene with headless Chrome (GPU rendering), driven over CDP.
// Node 20: run with --experimental-websocket. Steps run in order:
//
//   node --experimental-websocket scripts/shot.mjs --url 'http://localhost:3010/harness.html?domain=braid' \
//     --wait 'window.__harness' --eval '__harness.show("relation")' --sleep 1500 --shot .local/shots/braid.png
//
// Options: --url <u> (required, first)   --size <W>x<H> (default 1600x1000)   --dpr <n> (default 1)
// Steps:   --wait '<js truthy>' (up to 30 s)   --eval '<js>' (awaited; result printed)   --sleep <ms>   --click <x>,<y>
//          --shot <file.png>   --class '<body class to add, e.g. capture>'
// Each run uses a fresh temporary Chrome profile under .local/chrome-shot/ and closes Chrome at the end.

import { spawn } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const args = process.argv.slice(2)
const opt = (name, dflt) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : dflt
}
const url = opt('--url')
if (!url) {
  console.error('usage: shot.mjs --url <u> [--size WxH] [--dpr n] steps...')
  process.exit(2)
}
const [W, H] = opt('--size', '1600x1000').split('x').map(Number)
const dpr = Number(opt('--dpr', '1'))
const port = 9300 + Math.floor(Math.random() * 600)
const profile = resolve('.local/chrome-shot', String(port))
mkdirSync(profile, { recursive: true })

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--use-angle=metal', '--enable-webgl', '--ignore-gpu-blocklist',
  '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--mute-audio', `--window-size=${W},${H}`, 'about:blank',
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
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? p.rej(new Error(JSON.stringify(msg.error))) : p.res(msg.result)
    }
  }
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: dpr, mobile: false })
  await send('Page.navigate', { url })
  await sleep(500)
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    const v = args[i + 1]
    if (a === '--url' || a === '--size' || a === '--dpr') {
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
      if (out !== undefined && out !== "undefined") console.log(process.env.FULL || out.length <= 4000 ? out : `${out.slice(0, 4000)}…`)
      i++
    } else if (a === '--sleep') {
      await sleep(Number(v))
      i++
    } else if (a === '--click') {
      // A real mouse press and release at CSS pixel x,y (CDP input, so pointer capture works as for a user).
      const [x, y] = v.split(',').map(Number)
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
      await sleep(120)
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
      await sleep(90)
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 })
      i++
    } else if (a === '--class') {
      await evaluate(`document.body.classList.add(${JSON.stringify(v)})`)
      i++
    } else if (a === '--shot') {
      const r = await send('Page.captureScreenshot', { format: 'png' })
      mkdirSync(dirname(resolve(v)), { recursive: true })
      writeFileSync(v, Buffer.from(r.data, 'base64'))
      console.log(`wrote ${v}`)
      i++
    }
  }
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
