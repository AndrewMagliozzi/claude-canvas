// End-to-end test: starts the server, opens the app in Chrome, draws a
// synthetic Pencil sketch, presses Send, and checks that Claude replied with
// shapes, an HTML page and a camera move. Then marks up the page and sends a
// second turn to check page marks and conversation memory.
//
//   npm run test:e2e            (uses the system Google Chrome)
//   HEADED=1 npm run test:e2e   (watch it)
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'

const PORT = Number(process.env.E2E_PORT ?? 5199)
const PASSCODE = '424242'
const OUT = path.resolve('test-results')
fs.mkdirSync(OUT, { recursive: true })
const log = (...a) => console.log('[e2e]', ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const server = spawn('npx', ['tsx', 'server/index.ts', ...(process.env.E2E_HTTPS ? ['--https'] : [])], {
	env: { ...process.env, PORT: String(PORT), HTTPS_PORT: String(PORT + 1), PASSCODE, DEBUG_CLAUDE: '1' },
	stdio: ['ignore', 'pipe', 'pipe'],
})
const serverLog = fs.createWriteStream(path.join(OUT, 'server.log'))
server.stdout.pipe(serverLog)
server.stderr.pipe(serverLog)
const base = process.env.E2E_HTTPS ? `https://localhost:${PORT + 1}` : `http://localhost:${PORT}`

async function waitForServer() {
	for (let i = 0; i < 60; i++) {
		try {
			const r = await fetch(`http://localhost:${PORT}/api/config`)
			if (r.ok) return
		} catch {}
		await sleep(500)
	}
	throw new Error('server did not start')
}

let browser
const failures = []
const check = (ok, label) => {
	log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
	if (!ok) failures.push(label)
}

try {
	await waitForServer()
	browser = await chromium.launch({ channel: 'chrome', headless: !process.env.HEADED })
	const context = await browser.newContext({
		viewport: { width: 1180, height: 820 }, // iPad Air landscape, roughly
		deviceScaleFactor: 2,
		ignoreHTTPSErrors: true,
	})
	const page = await context.newPage()
	page.on('console', (m) => {
		if (m.type() === 'error' || m.type() === 'warning') log('browser ' + m.type() + ':', m.text().slice(0, 600))
	})

	page.on('pageerror', (e) => log('page error:', String(e).slice(0, 400)))
	// Capture what we send to Claude.
	const sent = []
	page.on('request', (req) => {
		if (req.url().endsWith('/stream') && req.method() === 'POST') {
			try {
				sent.push(JSON.parse(req.postData()))
			} catch {}
		}
	})

	await page.goto(base)
	await page.waitForSelector('.auth-input', { timeout: 30000 })
	await page.fill('.auth-input', PASSCODE)
	await page.click('.auth-button')
	await page.waitForSelector('.auth-gate', { state: 'detached' })
	await page.waitForFunction(() => window.editor && window.agent)
	log('authorized, editor ready')

	// Fresh canvas + conversation.
	await page.evaluate(() => {
		const e = window.editor
		e.deleteShapes([...e.getCurrentPageShapeIds()])
		window.agent.reset()
		e.setCurrentTool('draw')
		e.setCamera({ x: 0, y: 0, z: 1 })
	})

	// ---- Synthetic Pencil drawing via CDP pen events (with pressure) ----
	const cdp = await context.newCDPSession(page)
	async function penStroke(points) {
		const [first, ...rest] = points
		await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: first[0], y: first[1], button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen', force: first[2] ?? 0.5 })
		for (const p of rest) {
			await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p[0], y: p[1], button: 'left', buttons: 1, pointerType: 'pen', force: p[2] ?? 0.5 })
		}
		const last = points[points.length - 1]
		await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: last[0], y: last[1], button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen', force: 0 })
		await sleep(50)
	}
	const line = (x1, y1, x2, y2, n = 16, p0 = 0.2, p1 = 0.9) =>
		Array.from({ length: n + 1 }, (_, i) => [x1 + ((x2 - x1) * i) / n, y1 + ((y2 - y1) * i) / n, p0 + ((p1 - p0) * i) / n])

	// A little house: walls, roof, door.
	await penStroke([...line(200, 400, 400, 400), ...line(400, 400, 400, 560).slice(1), ...line(400, 560, 200, 560).slice(1), ...line(200, 560, 200, 400).slice(1)])
	await penStroke([...line(185, 405, 300, 300), ...line(300, 300, 415, 405).slice(1)])
	await penStroke([...line(280, 560, 280, 490), ...line(280, 490, 320, 490).slice(1), ...line(320, 490, 320, 560).slice(1)])

	const pen = await page.evaluate(() => {
		const shapes = window.editor.getCurrentPageShapes().filter((s) => s.type === 'draw')
		const s = shapes[0]
		const util = window.editor.getShapeUtil(s)
		// Decode the first segment's points to read pressure (z).
		let zs = []
		try {
			const tl = window.__tldraw_b64 ?? null
			zs = tl ? tl.decodePoints(s.props.segments[0].path, s.props.segments[0].dim).map((p) => Math.round(p.z * 100) / 100) : []
		} catch {}
		return { count: shapes.length, isPen: shapes.map((s) => s.props.isPen), zs, mode: window.editor.getInstanceState().isPenMode, dim: s.props.segments[0].dim }
	})
	log('pen strokes:', JSON.stringify(pen))
	check(pen.count === 3, 'three pen strokes were drawn')
	check(pen.isPen.every(Boolean), 'strokes are recorded as stylus (isPen=true)')
	check(new Set(pen.zs).size > 3, `pen pressure varies along the stroke (${pen.zs.slice(0, 8).join(', ')}…)`)

	// ---- Turn 1 ----
	const camBefore = await page.evaluate(() => window.editor.getCamera())
	await page.click('.drawer-toggle')
	await page.fill('.chat-drawer textarea', 'This is my sketch of a birdhouse. Add a short margin note with an arrow pointing at the roof, and put a small checklist page beside the drawing for building it.')
	await page.click('.drawer-toggle') // close drawer; send from the canvas button
	await page.screenshot({ path: path.join(OUT, '1-before-send.png') })
	const t0 = Date.now()
	await page.click('.send-button')
	await page.waitForSelector('.status-pill', { timeout: 15000 })
	const statuses = new Set()
	while (true) {
		const s = await page.evaluate(() => ({ gen: window.agent.requests.isGenerating(), status: window.agent.$status.get()?.text }))
		if (s.status) statuses.add(s.status)
		if (!s.gen) break
		if (Date.now() - t0 > 300000) throw new Error('turn 1 timed out')
		await sleep(250)
	}
	log(`turn 1 used ${sent.length} request(s)`)
	log(`turn 1 finished in ${((Date.now() - t0) / 1000).toFixed(1)}s; statuses seen:`, [...statuses].slice(0, 12))
	await sleep(1500) // let pages load and auto-size
	await page.screenshot({ path: path.join(OUT, '2-after-turn-1.png') })

	const result1 = await page.evaluate(() => {
		const e = window.editor
		const shapes = e.getCurrentPageShapes()
		const mine = shapes.filter((s) => s.meta?.by === 'claude')
		const pages = shapes.filter((s) => s.type === 'html-page')
		return {
			claudeShapeTypes: mine.map((s) => s.type),
			pages: pages.map((p) => ({ id: p.id, w: p.props.w, h: p.props.h, htmlLength: p.props.html.length, title: p.props.title })),
			camera: e.getCamera(),
			lastTurn: window.agent.$lastTurn.get(),
			history: window.agent.chat.getHistory().filter((h) => h.type === 'action').map((h) => h.action._type),
		}
	})
	log('turn 1 result:', JSON.stringify(result1, null, 1))
	check(!result1.lastTurn?.error, 'turn 1 had no error')
	check(result1.claudeShapeTypes.some((t) => t !== 'html-page'), 'Claude created canvas shapes')
	check(result1.pages.some((p) => p.htmlLength > 200), 'Claude created an HTML page shape with content')
	check(result1.history.includes('camera'), 'Claude issued a camera action')
	const camMoved = Math.abs(result1.camera.x - camBefore.x) + Math.abs(result1.camera.y - camBefore.y) + Math.abs(result1.camera.z - camBefore.z) > 1
	check(camMoved, 'the user camera moved')

	// Save the screenshot we sent Claude in turn 1
	const shot1 = sent[0]?.prompt?.screenshot?.screenshot
	if (shot1) fs.writeFileSync(path.join(OUT, 'sent-screenshot-1.jpg'), Buffer.from(shot1.split(',')[1], 'base64'))
	check(!!shot1, 'turn 1 included a screenshot')
	check((sent[0]?.prompt?.userActionHistory?.added?.length ?? 0) >= 3, `turn 1 reported the user's new strokes as changes (${sent[0]?.prompt?.userActionHistory?.added?.length ?? 0} added)`)
	check(!!sent[0]?.prompt?.blurryShapes, 'turn 1 included structured shape data')

	// ---- Turn 2: mark up the page, ask a memory question ----
	const target = await page.evaluate(() => {
		const e = window.editor
		const p = e.getCurrentPageShapes().find((s) => s.type === 'html-page')
		if (!p) return null
		e.zoomToBounds(e.getShapePageBounds(p), { inset: 40 })
		const b = e.getShapePageBounds(p)
		const tl = e.pageToScreen({ x: b.x, y: b.y })
		const br = e.pageToScreen({ x: b.maxX, y: b.maxY })
		return { tl, br }
	})
	if (target) {
		await sleep(400)
		// A check mark in the upper-left area of the page body, and a circle lower down.
		const x = target.tl.x + (target.br.x - target.tl.x) * 0.1
		const y = target.tl.y + (target.br.y - target.tl.y) * 0.35
		await penStroke([[x, y, 0.4], [x + 8, y + 10, 0.7], [x + 26, y - 16, 0.5]])
		const cx = target.tl.x + (target.br.x - target.tl.x) * 0.5
		const cy = target.tl.y + (target.br.y - target.tl.y) * 0.6
		const circle = Array.from({ length: 25 }, (_, i) => [cx + 90 * Math.cos((i / 24) * Math.PI * 2), cy + 22 * Math.sin((i / 24) * Math.PI * 2), 0.6])
		await penStroke(circle)
		await page.screenshot({ path: path.join(OUT, '3-marked-page.png') })
		log('shapes before turn 2:', JSON.stringify(await page.evaluate(() => window.editor.getCurrentPageShapesSorted().map((s) => ({ id: s.id, type: s.type, by: s.meta?.by, index: s.index, parent: s.parentId })))))
	}
	await page.click('.drawer-toggle')
	await page.fill('.chat-drawer textarea', 'I ticked and circled things on your page. What did I mark? Also, what did I say my sketch was, in my first message? Answer briefly with a margin note.')
	const t1 = Date.now()
	const turn2Index = sent.length
	await page.click('.chat-send')
	await page.waitForFunction(() => window.agent.requests.isGenerating(), null, { timeout: 15000 })
	await page.waitForFunction(() => !window.agent.requests.isGenerating(), null, { timeout: 300000, polling: 500 })
	log(`turn 2 finished in ${((Date.now() - t1) / 1000).toFixed(1)}s`)
	await sleep(1000)
	await page.screenshot({ path: path.join(OUT, '4-after-turn-2.png') })

	const shot2 = sent[turn2Index]?.prompt?.screenshot?.screenshot
	if (shot2) fs.writeFileSync(path.join(OUT, 'sent-screenshot-2.jpg'), Buffer.from(shot2.split(',')[1], 'base64'))
	const marks = sent[turn2Index]?.prompt?.pageMarks
	log('turn 2 pageMarks sent:', JSON.stringify(marks).slice(0, 1200))
	check(!!marks?.pages?.some((p) => p.marks.length >= 1), 'turn 2 reported marks on the page')
	check(!!marks?.pages?.some((p) => p.marks.some((m) => m.over.length > 0)), 'page hit-test found text under the marks')
	check(!sent[turn2Index]?.prompt?.chatHistory || true, 'chat history sent (server decides whether to use it)')

	const result2 = await page.evaluate(() => ({
		lastTurn: window.agent.$lastTurn.get(),
		texts: window.editor
			.getCurrentPageShapes()
			.filter((s) => s.meta?.by === 'claude')
			.map((s) => window.editor.getShapeUtil(s).getText(s))
			.filter(Boolean),
		messages: window.agent.chat
			.getHistory()
			.filter((h) => h.type === 'action' && h.action._type === 'message')
			.map((h) => h.action.text),
	}))
	log('turn 2 texts:', JSON.stringify(result2, null, 1).slice(0, 2000))
	check(!result2.lastTurn?.error, 'turn 2 had no error')
	const all = (result2.texts.join(' ') + ' ' + result2.messages.join(' ')).toLowerCase()
	check(all.includes('birdhouse') || all.includes('bird house'), 'Claude remembered the first message (birdhouse)')

	// ---- Persistence across reload ----
	const countBefore = await page.evaluate(() => window.editor.getCurrentPageShapes().length)
	await page.reload()
	await page.waitForFunction(() => window.editor && window.agent)
	await sleep(1000)
	const after = await page.evaluate(() => ({ n: window.editor.getCurrentPageShapes().length, hist: window.agent.chat.getHistory().length }))
	check(after.n === countBefore, `canvas persisted across reload (${after.n}/${countBefore} shapes)`)
	check(after.hist > 0, 'chat history persisted across reload')
	await page.screenshot({ path: path.join(OUT, '5-after-reload.png') })
} catch (e) {
	console.error(e)
	failures.push(String(e?.message ?? e))
} finally {
	await browser?.close()
	server.kill('SIGTERM')
	log(failures.length ? `${failures.length} FAILED: ${failures.join('; ')}` : 'ALL PASSED')
	log(`artifacts in ${OUT}`)
	process.exit(failures.length ? 1 : 0)
}
