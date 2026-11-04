#!/usr/bin/env node
// Drive the math-workspace page on a Quest Browser over the Chrome DevTools Protocol (adb-forwarded).
// Pattern from seal-duel/scripts/headset-session.mjs. Node 20: run with --experimental-websocket.
//
//   adb reverse tcp:3010 tcp:3010                                  headset -> dev server
//   adb forward tcp:9222 localabstract:chrome_devtools_remote      Mac -> page (CDP)
//   node --experimental-websocket scripts/headset.mjs pages
//   node --experimental-websocket scripts/headset.mjs eval '__mw.device.info()'
//
// Commands: pages | eval <js> (awaited, printed as JSON; RAW=1 prints it on one line, for JSONL)
// Errors never list other tabs: `pages` is the only command that prints page URLs.

const PORT = Number(process.env.CDP_PORT || 9222)
const MATCH = process.env.PAGE_MATCH || 'localhost:3010'
// Every step is bounded: a sleeping headset freezes the page, and an unbounded wait would stall the caller.
// EVAL_TIMEOUT_MS covers the longest awaited expression (round C's untraced window is about 57 s).
const EVAL_TIMEOUT_MS = Number(process.env.EVAL_TIMEOUT_MS || 120000)

const within = (ms, what, promise) =>
  new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error(`${what} timed out after ${ms} ms`)), ms)
    promise.then((v) => (clearTimeout(timer), res(v)), (e) => (clearTimeout(timer), rej(e)))
  })

async function pages() {
  const r = await fetch(`http://127.0.0.1:${PORT}/json`, { signal: AbortSignal.timeout(10000) })
  return r.json()
}

async function evaluate(expression) {
  const list = await pages()
  const page = list.find((p) => p.type === 'page' && String(p.url).includes(MATCH))
  if (!page) throw new Error(`no page matching ${MATCH} (${list.length} targets open)`)
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  try {
    await within(10000, 'CDP connection', new Promise((res, rej) => {
      ws.onopen = res
      ws.onerror = rej
    }))
    const result = await within(EVAL_TIMEOUT_MS, 'evaluation', new Promise((res, rej) => {
      ws.onmessage = (m) => {
        const msg = JSON.parse(String(m.data))
        if (msg.id === 1) res(msg)
      }
      ws.onerror = rej
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: `(async () => JSON.stringify(await (${expression})))()`, awaitPromise: true, returnByValue: true } }))
    }))
    return unwrap(result)
  } finally {
    ws.close()
  }
}

function unwrap(result) {
  if (result.error) throw new Error(`CDP error: ${JSON.stringify(result.error).slice(0, 400)}`)
  if (result.result?.exceptionDetails) throw new Error(JSON.stringify(result.result.exceptionDetails).slice(0, 800))
  return result.result?.result?.value
}

const [cmd, ...rest] = process.argv.slice(2)
try {
  if (cmd === 'pages') console.log(JSON.stringify((await pages()).map((p) => ({ type: p.type, url: p.url, title: p.title })), null, 1))
  else if (cmd === 'eval') {
    const v = await evaluate(rest.join(' '))
    try {
      console.log(process.env.RAW ? JSON.stringify(JSON.parse(v)) : JSON.stringify(JSON.parse(v), null, 1))
    } catch {
      console.log(v)
    }
  } else console.log('usage: headset.mjs pages | eval <js>')
} catch (err) {
  console.error(String(err))
  process.exit(1)
}
