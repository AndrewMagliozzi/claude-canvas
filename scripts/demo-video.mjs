// Records a ~60s demo of Claude Canvas: real canvas + Pencil strokes, a scripted
// (illustrative) Duet chat beside it, captions, then encodes demo/claude-canvas-demo.mp4.
//   node scripts/demo-video.mjs
// Runs its own server on a spare port with a throwaway data dir; never touches .data.
// Needs ffmpeg on PATH. All names and content are fictional.
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { chromium } from 'playwright-core'

const PORT = 5191
const PASSCODE = '919191'
const TOKEN = 'demo-video-connector-token-0001'
const W = 1920
const H = 1080
const CHAT_W = 560
const OUT = path.resolve('test-results/demo')
const FRAMES = path.join(OUT, 'frames')
const FINAL = path.resolve('demo/claude-canvas-demo.mp4')
fs.rmSync(FRAMES, { recursive: true, force: true })
fs.mkdirSync(FRAMES, { recursive: true })
fs.mkdirSync(path.dirname(FINAL), { recursive: true })
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-demo-'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log('[demo]', ...a)

const server = spawn(path.resolve('node_modules/.bin/tsx'), ['server/index.ts'], {
	env: { ...process.env, PORT: String(PORT), PASSCODE, CONNECTOR_TOKEN: TOKEN, CANVAS_DATA_DIR: DATA_DIR },
	stdio: ['ignore', 'pipe', 'pipe'],
	detached: true,
})
server.stdout.pipe(fs.createWriteStream(path.join(OUT, 'server.log')))
server.stderr.pipe(fs.createWriteStream(path.join(OUT, 'server.err.log')))

// ---------------------------------------------------------------- wrapper page
const WRAPPER = `<!doctype html><html><head><meta charset="utf-8"><title>demo</title><style>
:root{--ink:#1f1d1a;--muted:#6f6a62;--rule:#e6e1d8;--paper:#faf8f4;--accent:#c96442;--bubble:#efebe3}
*{box-sizing:border-box}html,body{margin:0;height:100%;background:var(--paper);font:16px/1.45 -apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,sans-serif;color:var(--ink);overflow:hidden}
#chat{position:absolute;left:0;top:0;width:${CHAT_W}px;height:100%;display:flex;flex-direction:column;border-right:1px solid var(--rule);background:#fff}
#chat header{padding:22px 26px 16px;border-bottom:1px solid var(--rule);display:flex;align-items:baseline;gap:10px}
#chat header b{font-size:20px}#chat header span{font-size:13px;color:var(--muted)}
#msgs{flex:1;overflow:hidden;padding:20px 22px;display:flex;flex-direction:column;justify-content:flex-end;gap:14px}
.m{max-width:92%;padding:12px 16px;border-radius:16px;font-size:16.5px;line-height:1.5;animation:in .25s ease-out}
.m.u{align-self:flex-end;background:var(--bubble);border-bottom-right-radius:4px}
.m.d{align-self:flex-start;background:#fff;border:1px solid var(--rule);border-bottom-left-radius:4px}
.m.d ol,.m.d ul{margin:6px 0 4px;padding-left:22px}.m.d li{margin:3px 0}
.chip{align-self:flex-start;font:13px ui-monospace,Menlo,monospace;color:var(--muted);background:var(--paper);border:1px solid var(--rule);border-radius:999px;padding:5px 12px;animation:in .25s}
.chip:before{content:"⚙ ";color:var(--accent)}
@keyframes in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
#input{margin:14px 22px 22px;min-height:54px;border:1px solid var(--rule);border-radius:14px;padding:14px 16px;font-size:16.5px;color:var(--ink);background:var(--paper)}
#input:empty:before{content:"Message Duet…";color:#aaa49a}
#input.typing:after{content:"";display:inline-block;width:2px;height:18px;background:var(--ink);vertical-align:-3px;margin-left:1px;animation:blink 1s steps(1) infinite}
@keyframes blink{50%{opacity:0}}
#canvasWrap{position:absolute;left:${CHAT_W}px;top:0;right:0;bottom:0}
#canvas{width:100%;height:100%;border:0;display:block}
#dim{position:absolute;inset:0;background:rgba(250,248,244,.94);display:flex;align-items:center;justify-content:center;flex-direction:column;gap:10px;opacity:0;transition:opacity .5s;pointer-events:none}
#dim.on{opacity:1}#dim b{font-size:34px;letter-spacing:-.01em}#dim span{color:var(--muted);font-size:19px}
#cap{position:absolute;left:50%;bottom:34px;transform:translate(-50%,10px);background:rgba(31,29,26,.92);color:#fff;font-size:24px;font-weight:550;letter-spacing:-.005em;padding:14px 26px;border-radius:14px;opacity:0;transition:opacity .35s,transform .35s;white-space:nowrap;box-shadow:0 8px 30px rgba(0,0,0,.18)}
#cap.on{opacity:1;transform:translate(-50%,0)}#cap small{display:block;font-size:16px;font-weight:400;opacity:.75;margin-top:2px}
#tag{position:absolute;top:18px;left:50%;transform:translateX(-50%);background:var(--accent);color:#fff;font-size:15px;font-weight:600;padding:7px 14px;border-radius:999px;opacity:0;transition:opacity .3s}
#tag.on{opacity:1}
#card{position:fixed;inset:0;background:var(--paper);display:flex;align-items:center;justify-content:center;flex-direction:column;text-align:center;gap:18px;opacity:0;transition:opacity .6s;pointer-events:none;z-index:9}
#card.on{opacity:1}#card h1{font:600 84px/1.05 Georgia,"Iowan Old Style",serif;margin:0;letter-spacing:-.02em}
#card p{font-size:28px;color:var(--muted);margin:0}#card .rows{display:flex;gap:44px;margin-top:22px;font-size:24px}
#card .rows div{display:flex;flex-direction:column;align-items:center;gap:8px}#card .rows i{font-style:normal;font-size:40px;color:var(--accent)}
#card .fine{position:absolute;bottom:34px;font-size:15px;color:#a39d93}
</style></head><body>
<div id="chat"><header><b>Duet</b><span>chat · illustrative</span></header><div id="msgs"></div><div id="input"></div></div>
<div id="canvasWrap"><iframe id="canvas" src="/"></iframe><div id="dim"><b>Chat only</b><span>Everything happens in text</span></div><div id="tag"></div><div id="cap"></div></div>
<div id="card" class="on"></div>
<script>
const $=s=>document.querySelector(s)
window.demo={
 card(html){const c=$('#card');if(html){c.innerHTML=html;c.classList.add('on')}else c.classList.remove('on')},
 dim(on){$('#dim').classList.toggle('on',on)},
 tag(t){const e=$('#tag');if(t){e.textContent=t;e.classList.add('on')}else e.classList.remove('on')},
 cap(t,sub){const e=$('#cap');if(t){e.innerHTML=t+(sub?'<small>'+sub+'</small>':'');e.classList.add('on')}else e.classList.remove('on')},
 msg(role,html){const m=document.createElement('div');m.className='m '+role;m.innerHTML=html;$('#msgs').append(m)},
 chip(t){const m=document.createElement('div');m.className='chip';m.textContent=t;$('#msgs').append(m)},
 clear(){$('#msgs').innerHTML=''},
 async type(text,ms){const i=$('#input');i.classList.add('typing');for(const ch of text){i.textContent+=ch;await new Promise(r=>setTimeout(r,ms))}await new Promise(r=>setTimeout(r,350));i.classList.remove('typing');const t=i.textContent;i.textContent='';window.demo.msg('u',t.replace(/&/g,'&amp;').replace(/</g,'&lt;'))}
}
</script></body></html>`

// ---------------------------------------------------------------- content (fictional)
const SWEEP = {
	title: '5 things waiting on you',
	items: [
		{ what: 'Pay the Lakeside Hall venue deposit', detail: '$1,200 · due Friday' },
		{ what: 'Accept the Northwind intro call', detail: 'Thu 4pm · overlaps your focus block' },
		{ what: 'Send the Q4 board update', detail: 'Draft ready · 2 pages' },
		{ what: 'Move your 1:1 with Sam to Friday', detail: 'Sam offered Fri 11am or 2pm' },
		{ what: 'Renew the design-tool subscription', detail: '$40/month · renews Dec 1' },
	],
}
const MARKS = ['Approve', 'Skip', 'Approve', 'Edit', 'Approve']
const DRAFT = {
	title: 'Q4 board update',
	kind: 'Board memo draft',
	ask: 'Strike what to cut. Duet makes the exact edits.',
	paragraphs: [
		'Q4 closed ahead of plan: revenue grew 18% and we added two enterprise customers.',
		'Hiring is on track. We would like to take a moment to thank everyone for their incredible patience. Two senior engineers start in January.',
		'For the next meeting we propose a vote on the 2027 budget.',
	],
}
const CUT = 'We would like to take a moment to thank everyone for their incredible patience. '

const GLYPHS = {
	C: [[[6, 1.5], [4, 0], [2, 0.3], [0.5, 2], [0, 5], [0.5, 8], [2, 9.7], [4, 10], [6, 8.5]]],
	A: [[[0, 10], [3, 0], [6, 10]], [[1.3, 6], [4.7, 6]]],
	L: [[[0, 0], [0, 10], [5, 10]]],
	N: [[[0, 10], [0, 0], [6, 10], [6, 0]]],
}

let browser
const frames = []
let tStart = 0
let tEnd = 0
try {
	for (let i = 0; i < 60; i++) {
		try {
			if ((await fetch(`http://localhost:${PORT}/api/config`)).ok) break
		} catch {}
		await sleep(500)
	}
	browser = await chromium.launch({ channel: 'chrome', headless: true })
	const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
	const page = await context.newPage()
	page.on('pageerror', (e) => log('page error:', String(e).slice(0, 200)))
	await page.route(`http://localhost:${PORT}/__demo`, (r) => r.fulfill({ contentType: 'text/html', body: WRAPPER }))
	await page.goto(`http://localhost:${PORT}/__demo`)
	const demo = (fn, ...args) => page.evaluate(([fn, args]) => window.demo[fn](...args), [fn, args])
	await demo('card', '<h1>Claude Canvas</h1><p>Work with Duet on your iPad, with your Pencil.</p>')

	// Log in inside the canvas iframe.
	const canvasEl = await page.waitForSelector('#canvas')
	const canvas = await canvasEl.contentFrame()
	await canvas.waitForSelector('.auth-input')
	await canvas.fill('.auth-input', PASSCODE)
	await canvas.click('.auth-button')
	await canvas.waitForFunction(() => window.editor && window.agent)
	await canvas.evaluate(() => {
		const e = window.editor
		e.deleteShapes([...e.getCurrentPageShapeIds()])
		e.setCamera({ x: 0, y: 0, z: 1 })
	})
	await canvas.addStyleTag({ content: ".tlui-style-panel__wrapper{display:none!important}" })
	const mcp = new Client({ name: 'demo', version: '1' })
	await mcp.connect(new StreamableHTTPClientTransport(new URL(`http://localhost:${PORT}/mcp/${TOKEN}`)))
	await sleep(1500)

	// Screen capture via CDP screencast (frames arrive on change, with timestamps).
	const cdp = await context.newCDPSession(page)
	cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
		const file = path.join(FRAMES, `${String(frames.length).padStart(5, '0')}.jpg`)
		frames.push({ file, ts: metadata.timestamp })
		fs.writeFileSync(file, Buffer.from(data, 'base64'))
		cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
	})
	await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: W, maxHeight: H, everyNthFrame: 1 })
	await sleep(300)
	tStart = Date.now() / 1000
	const mark = (l) => log(l.padEnd(14), ((Date.now() / 1000 - tStart)).toFixed(1) + "s")

	// ---- Pencil helpers (page-level coordinates) ----
	const jitter = () => (Math.random() - 0.5) * 0.5
	async function stroke(points, perPoint = 5) {
		const [f, ...rest] = points
		await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: f[0], y: f[1], button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen', force: 0.5 })
		for (const p of rest) {
			await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p[0], y: p[1], button: 'left', buttons: 1, pointerType: 'pen', force: 0.6 })
			await sleep(perPoint)
		}
		const l = points.at(-1)
		await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: l[0], y: l[1], button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen', force: 0 })
		await sleep(60)
	}
	async function pageFrame() {
		const handle = await canvas.waitForSelector('.html-page-shape iframe')
		await sleep(200)
		const frame = await handle.contentFrame()
		const box = await handle.boundingBox()
		return { frame, box, scale: box.width / 720 }
	}
	async function rectIn(pf, fn, arg) {
		const r = await pf.frame.evaluate(fn, arg)
		return { x: pf.box.x + r.x * pf.scale, y: pf.box.y + r.y * pf.scale, w: r.w * pf.scale, h: r.h * pf.scale }
	}
	const elRect = (sel) => {
		const b = document.querySelector(sel).getBoundingClientRect()
		return { x: b.x, y: b.y, w: b.width, h: b.height }
	}
	async function circle(r) {
		const cx = r.x + r.w / 2
		const cy = r.y + r.h / 2
		const n = 24
		await stroke(Array.from({ length: n + 3 }, (_, i) => {
			const a = -0.6 + (i / n) * 2 * Math.PI
			return [cx + (r.w / 2 + 9) * Math.cos(a) + jitter() * 2, cy + (r.h / 2 + 6) * Math.sin(a) + jitter() * 2]
		}))
	}
	async function write(text, x, y, unit) {
		for (const ch of text) {
			if (ch === ' ') {
				x += 6 * unit
				continue
			}
			for (const s of GLYPHS[ch]) {
				const pts = []
				for (let i = 0; i < s.length - 1; i++) for (let t = 0; t < 1; t += 0.25) pts.push([x + (s[i][0] + (s[i + 1][0] - s[i][0]) * t + jitter()) * unit, y + (s[i][1] + (s[i + 1][1] - s[i][1]) * t + jitter()) * unit])
				const last = s.at(-1)
				pts.push([x + last[0] * unit, y + last[1] * unit])
				await stroke(pts, 2)
			}
			x += 8.5 * unit
		}
	}
	const drawTool = () => canvas.evaluate(() => {
		window.editor.setCurrentTool('draw')
	})

	// ==== 0. title
	mark("0. title".slice(0,14))
	await sleep(3400)
	await demo("dim", true)
	await demo('card', null)
	await sleep(700)

	// ==== 1. chat alone
	mark("1. chat alone".slice(0,14))
	await demo('tag', 'Before · chat alone')
	await demo('type', "What's waiting on me today?", 22)
	await sleep(500)
	await demo(
		'msg',
		'd',
		'Five things need your OK:<ol><li>Pay the Lakeside Hall venue deposit ($1,200, due Fri)</li><li>Accept the Northwind intro call (Thu 4pm, overlaps focus time)</li><li>Send the Q4 board update (draft ready)</li><li>Move your 1:1 with Sam to Friday</li><li>Renew the design-tool subscription ($40/mo)</li></ol>Reply with approve, edit or skip for each.'
	)
	await demo('cap', 'Chat alone: read a list, then type back every decision')
	await sleep(3000)
	await demo('type', '1 approve, 2 skip, 3 approve, 4 edit, 5 approve. and remind me to call anna', 24)
	await sleep(2000)
	await demo('cap', null)
	await sleep(400)

	// ==== 2. with canvas
	mark("2. with canvas".slice(0,14))
	await demo('clear')
	await demo('tag', 'With Claude Canvas')
	await demo('type', 'Put it on my iPad.', 26)
	await demo('chip', 'canvas · show_template(approvals_sweep)')
	await mcp.callTool({ name: 'show_template', arguments: { template: 'approvals_sweep', data: SWEEP } })
	await demo('dim', false)
	await sleep(900)
	await demo('msg', 'd', 'Done: all five are on one sheet on your iPad. Circle one per row.')
	await sleep(1800)
	await demo('cap', 'One sheet, everything at once', 'Circle an answer per row with the Pencil')
	let pf = await pageFrame()
	await drawTool()
	for (let i = 0; i < MARKS.length; i++) {
		const r = await rectIn(pf, (sel) => {
			const b = document.querySelector(sel).getBoundingClientRect()
			return { x: b.x, y: b.y, w: b.width, h: b.height }
		}, `[data-cc-question="${i + 1}. ${SWEEP.items[i].what}"] [data-cc-option="${MARKS[i]}"]`)
		await circle(r)
		await sleep(60)
	}
	await demo('cap', 'Jot anything else in the tray', 'Duet reads your handwriting')
	const tray = await rectIn(pf, elRect, '[data-cc-region="tray"]')
	await write('CALL ANNA', tray.x + 28, tray.y + tray.h * 0.3, Math.min(3.4, (tray.h * 0.45) / 10))
	await sleep(1900)

	// ==== 3. Duet reads it, asks once
	mark("3. Duet reads it, asks once".slice(0,14))
	await demo('cap', null)
	await demo('type', 'Check my iPad.', 26)
	await demo('chip', 'canvas · look_at_canvas')
	// The real look (marks + handwriting transcription) runs alongside the scripted reply; logged below.
	const lookPromise = mcp.callTool({ name: 'look_at_canvas', arguments: { includeScreenshot: false } }).catch((e) => ({ error: String(e) }))
	await sleep(1800)
	await demo(
		'msg',
		'd',
		'From your iPad:<ul><li>✓ Pay Lakeside Hall deposit ($1,200)</li><li>✓ Send the Q4 board update</li><li>✓ Renew the design tool ($40/mo)</li><li>✎ Sam 1:1: what should change?</li><li>– Skip the Northwind call</li><li>✍ “Call Anna”: added to today</li></ul><b>Shall I go ahead with the three approvals?</b>'
	)
	await demo('cap', 'Duet reads every mark, then asks once', 'Nothing is sent, paid or booked until you say yes')
	await sleep(4600)
	await demo('type', 'Yes.', 60)
	await sleep(1500)
	await demo('cap', null)

	// ==== 4. redline
	mark("4. redline".slice(0,14))
	await demo('clear')
	await demo('type', 'Let me mark up the board update first.', 22)
	await demo('chip', 'canvas · show_template(document_markup)')
	await canvas.evaluate(() => {
		const e = window.editor
		e.deleteShapes([...e.getCurrentPageShapeIds()])
	})
	const shown = await mcp.callTool({ name: 'show_template', arguments: { template: 'document_markup', data: DRAFT } })
	const draftId = JSON.parse(shown.content[0].text).pageId
	await sleep(900)
	await demo('msg', 'd', 'On your iPad. Strike anything you want cut.')
	await demo('cap', 'Mark up drafts like paper')
	pf = await pageFrame()
	await drawTool()
	// Strike the filler sentence line by line.
	const lines = await pf.frame.evaluate((cut) => {
		const p = document.querySelector('[data-cc-region="para:2"]')
		const node = p.firstChild
		const start = node.textContent.indexOf(cut.trim())
		const range = document.createRange()
		range.setStart(node, start)
		range.setEnd(node, start + cut.trim().length)
		return [...range.getClientRects()].filter((r) => r.width > 4).map((r) => ({ x: r.x, y: r.y, w: r.width, h: r.height }))
	}, CUT)
	for (const l of lines) {
		const x0 = pf.box.x + l.x * pf.scale
		const x1 = pf.box.x + (l.x + l.w) * pf.scale
		const y = pf.box.y + (l.y + l.h * 0.55) * pf.scale
		await stroke(Array.from({ length: 22 }, (_, i) => [x0 + ((x1 - x0) * i) / 21, y + jitter() * 3]), 6)
	}
	await sleep(1300)
	await demo('type', 'Done.', 60)
	await demo('chip', 'canvas · look_at_canvas')
	await sleep(1200)
	await demo('msg', 'd', 'Cut the sentence you struck in ¶2. The clean draft is on your iPad.')
	await canvas.evaluate(() => {
		const e = window.editor
		e.deleteShapes([...e.getCurrentPageShapeIds()].filter((id) => e.getShape(id)?.type === 'draw'))
	})
	await mcp.callTool({
		name: 'show_template',
		arguments: { template: 'document_markup', pageId: draftId, data: { ...DRAFT, paragraphs: DRAFT.paragraphs.map((p) => p.replace(CUT, '')) } },
	})
	await demo('cap', 'Duet gets the exact words you struck', 'and returns the clean draft')
	await sleep(4200)
	await demo('cap', null)

	// ==== end card
	mark("end card".slice(0,14))
	await demo(
		'card',
		'<h1>Claude Canvas</h1><p>Duet in chat. Your work on the canvas.</p><div class="rows"><div><i>▦</i>See it all at once</div><div><i>✎</i>Answer with the Pencil</div><div><i>✓</i>Duet asks before acting</div></div><div class="fine">Illustrative chat; canvas recorded live. Names and data are fictional.</div>'
	)
	await sleep(5000)
	tEnd = Date.now() / 1000
	await cdp.send('Page.stopScreencast')

	const look = await lookPromise
	if (look.error) log('look error:', look.error)
	else {
		const d = JSON.parse(look.content.find((x) => x.type === 'text' && x.text.startsWith('{')).text)
		log('real look · answers:', JSON.stringify((d.answersMarkedOnPages ?? []).map((a) => `${a.question} → ${a.answer}`)))
		log('real look · handwriting:', JSON.stringify((d.newHandwriting ?? []).map((h) => h.text)))
	}
	await mcp.close()
} catch (e) {
	console.error(e)
	process.exitCode = 1
} finally {
	await browser?.close()
	try {
		process.kill(-server.pid, 'SIGTERM')
	} catch {}
	fs.rmSync(DATA_DIR, { recursive: true, force: true })
}

// ---------------------------------------------------------------- encode
if (!process.exitCode && frames.length) {
	const kept = frames.filter((f) => f.ts >= tStart - 0.05 && f.ts <= tEnd)
	const before = frames.filter((f) => f.ts < tStart).at(-1)
	if (before) kept.unshift({ ...before, ts: tStart })
	let list = ''
	for (let i = 0; i < kept.length; i++) {
		const next = i + 1 < kept.length ? kept[i + 1].ts : tEnd
		list += `file '${kept[i].file}'\nduration ${Math.max(0.001, next - Math.max(kept[i].ts, tStart)).toFixed(4)}\n`
	}
	list += `file '${kept.at(-1).file}'\n`
	const listFile = path.join(OUT, 'frames.txt')
	fs.writeFileSync(listFile, list)
	execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-vf', 'fps=30,scale=in_range=full:out_range=limited,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-movflags', '+faststart', FINAL])
	log(`wrote ${FINAL} · ${(tEnd - tStart).toFixed(1)}s · ${kept.length} frames`)
}
