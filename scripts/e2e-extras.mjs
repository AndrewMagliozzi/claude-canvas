// Extra end-to-end checks: Stop mid-turn, one-finger pan in pen mode,
// conversation memory across a server restart, and the script action.
//   node scripts/e2e-extras.mjs
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'

const PORT = 5195
const PASSCODE = '343434'
const OUT = path.resolve('test-results')
fs.mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log('[extras]', ...a)
const failures = []
const check = (ok, label) => {
	log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
	if (!ok) failures.push(label)
}

let server
const serverLog = fs.createWriteStream(path.join(OUT, 'server-extras.log'))
async function startServer(extraEnv = {}) {
	server = spawn('npx', ['tsx', 'server/index.ts'], {
		env: { ...process.env, PORT: String(PORT), PASSCODE, DEBUG_CLAUDE: '1', CANVAS_MODEL: 'sonnet', ...extraEnv },
		stdio: ['ignore', 'pipe', 'pipe'],
	})
	server.stdout.pipe(serverLog, { end: false })
	server.stderr.pipe(serverLog, { end: false })
	for (let i = 0; i < 60; i++) {
		try {
			if ((await fetch(`http://localhost:${PORT}/api/config`)).ok) return
		} catch {}
		await sleep(500)
	}
	throw new Error('server did not start')
}
async function stopServer() {
	server.kill('SIGTERM')
	await new Promise((r) => server.once('exit', r))
}

async function sendAndWait(page, text, timeout = 240000) {
	await page.evaluate((t) => {
		window.__setDraft(t)
	}, text)
	await page.click('.send-button')
	await page.waitForFunction(() => window.agent.requests.isGenerating(), null, { timeout: 15000 })
	await page.waitForFunction(() => !window.agent.requests.isGenerating(), null, { timeout, polling: 300 })
	return page.evaluate(() => ({
		lastTurn: window.agent.$lastTurn.get(),
		texts: window.editor
			.getCurrentPageShapes()
			.filter((s) => s.meta?.by === 'claude')
			.map((s) => window.editor.getShapeUtil(s).getText(s) ?? '')
			.join(' | '),
		messages: window.agent.chat
			.getHistory()
			.filter((h) => h.type === 'action' && h.action._type === 'message')
			.map((h) => h.action.text)
			.join(' | '),
	}))
}

let browser
try {
	await startServer({ ENABLE_SCRIPT_ACTION: '1' })
	browser = await chromium.launch({ channel: 'chrome', headless: !process.env.HEADED })
	const context = await browser.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true })
	const page = await context.newPage()
	page.on('pageerror', (e) => log('page error:', String(e).slice(0, 300)))
	const sent = []
	page.on('request', (req) => {
		if (req.url().endsWith('/stream') && req.method() === 'POST') {
			try {
				sent.push(JSON.parse(req.postData()))
			} catch {}
		}
	})
	await page.goto(`http://localhost:${PORT}`)
	await page.fill('.auth-input', PASSCODE)
	await page.click('.auth-button')
	await page.waitForFunction(() => window.editor && window.agent)
	await page.evaluate(async () => {
		const { setDraft } = await import('/client/state.ts')
		window.__setDraft = setDraft
		const e = window.editor
		e.deleteShapes([...e.getCurrentPageShapeIds()])
		window.agent.reset()
	})

	// ---- One-finger pan in pen mode ----
	await page.evaluate(() => {
		window.editor.updateInstanceState({ isPenMode: true })
		window.editor.setCurrentTool('draw')
		window.editor.setCamera({ x: 0, y: 0, z: 1 })
	})
	const cdp = await context.newCDPSession(page)
	const touch = (type, x, y) =>
		cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] })
	await touch('touchStart', 500, 400)
	for (let i = 1; i <= 10; i++) await touch('touchMove', 500 + i * 15, 400 + i * 10)
	await touch('touchEnd')
	await sleep(200)
	const pan = await page.evaluate(() => ({ cam: window.editor.getCamera(), shapes: window.editor.getCurrentPageShapes().length }))
	check(Math.abs(pan.cam.x - 150) < 20 && Math.abs(pan.cam.y - 100) < 20, `one finger pans the canvas in pen mode (camera ${Math.round(pan.cam.x)},${Math.round(pan.cam.y)})`)
	check(pan.shapes === 0, 'a finger does not draw in pen mode')
	await page.evaluate(() => {
		window.editor.updateInstanceState({ isPenMode: false })
	})

	// ---- Stop mid-turn ----
	await page.evaluate((t) => window.__setDraft(t), 'Write me a long, detailed four-page illustrated history of bicycles as a page, with lots of sections.')
	await page.click('.send-button')
	await page.waitForSelector('.status-pill .stop-button', { timeout: 15000 })
	await sleep(4000)
	const tStop = Date.now()
	await page.click('.status-pill .stop-button')
	await page.waitForFunction(() => !window.agent.requests.isGenerating(), null, { timeout: 5000 })
	check(Date.now() - tStop < 3000, `Stop ends the turn promptly (${Date.now() - tStop}ms)`)
	// ---- Keep drawing while Claude works ----
	await page.evaluate((t) => window.__setDraft(t), 'Ignore that. Remember the code word PELICAN. Reply with a tiny margin note that says "noted".')
	await page.click('.send-button')
	await page.waitForFunction(() => window.agent.requests.isGenerating(), null, { timeout: 15000 })
	await page.evaluate(() => {
		window.editor.setCurrentTool('draw')
	})
	const midPts = Array.from({ length: 12 }, (_, i) => [700 + i * 12, 600 + (i % 2) * 14])
	await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: midPts[0][0], y: midPts[0][1], button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen', force: 0.5 })
	for (const [x, y] of midPts.slice(1)) await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1, pointerType: 'pen', force: 0.6 })
	await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: midPts[11][0], y: midPts[11][1], button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen', force: 0 })
	const strokeReqIndex = sent.length
	const midStroke = await page.evaluate(() => {
		const d = window.editor.getCurrentPageShapes().filter((s) => s.type === 'draw').at(-1)
		return d ? { id: d.id, by: d.meta?.by ?? null, generating: window.agent.requests.isGenerating() } : null
	})
	await page.waitForFunction(() => !window.agent.requests.isGenerating(), null, { timeout: 240000, polling: 300 })
	const afterStop = await page.evaluate(() => ({ lastTurn: window.agent.$lastTurn.get() }))
	check(!!midStroke && midStroke.generating, 'drew a stroke while Claude was working')
	check(midStroke && midStroke.by === null, 'the mid-turn stroke is yours, not tagged as Claude\'s')
	const strokeSurvived = await page.evaluate((id) => !!window.editor.getShape(id), midStroke?.id)
	check(strokeSurvived, 'the mid-turn stroke survived Claude\'s turn')
	check(!afterStop.lastTurn?.error, `the next turn after Stop works (${afterStop.lastTurn?.error ?? 'ok'})`)

	// ---- Script action ---- (also checks the mid-turn stroke is reported as a change)
	const scriptReqIndex = sent.length
	const script = await sendAndWait(
		page,
		'Test of the runScript action: use runScript (and nothing else besides a camera move if you like) to create a red rectangle at x=900,y=100 size 120x80 with editor.createShape, and return the number of shapes on the page.'
	)
	const hasRed = await page.evaluate(() =>
		window.editor.getCurrentPageShapes().some((s) => s.type === 'geo' && s.props.color === 'red')
	)
	const history = await page.evaluate(() => window.agent.chat.getHistory().filter((h) => h.type === 'action').map((h) => h.action._type))
	check(history.includes('runScript'), 'Claude used runScript when enabled')
	const added = sent.slice(strokeReqIndex).flatMap((r) => r.prompt?.userActionHistory?.added ?? [])
	check(midStroke && added.some((a) => 'shape:' + a.shapeId === midStroke.id), 'the mid-turn stroke appears in the next turn\'s changes')
	check(hasRed, 'the script ran against the editor')
	check(!script.lastTurn?.error, 'script turn had no error')

	// ---- Memory across a server restart ----
	await stopServer()
	await startServer({})
	// Vite's client reloads the page when the dev server comes back.
	await sleep(3000)
	await page.waitForFunction(() => window.editor && window.agent, null, { timeout: 30000 })
	await page.evaluate(async () => {
		const { setDraft } = await import('/client/state.ts')
		window.__setDraft = setDraft
	})
	const cfg = await page.evaluate(() => fetch('/api/config').then((r) => r.json()))
	check(cfg.enableScriptAction === false, 'script action is off by default')
	const recall = await sendAndWait(page, 'What was the code word I asked you to remember? Write it in a margin note.')
	check(/pelican/i.test(recall.texts + ' ' + recall.messages), 'Claude remembered the code word after a server restart')
	const logText = fs.readFileSync(path.join(OUT, 'server-extras.log'), 'utf8')
	check(/memory=true/.test(logText.split('Claude Canvas').pop() ?? ''), 'the restarted server resumed the Claude session (no history replay)')
	await page.screenshot({ path: path.join(OUT, 'extras-final.png') })
} catch (e) {
	console.error(e)
	failures.push(String(e?.message ?? e))
} finally {
	await browser?.close()
	server?.kill('SIGTERM')
	log(failures.length ? `${failures.length} FAILED: ${failures.join('; ')}` : 'ALL PASSED')
	process.exit(failures.length ? 1 : 0)
}
