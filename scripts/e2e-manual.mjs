// Tests building the operating manual together on the canvas:
// Duet proposes rules on a worksheet → the person drops one and writes a new
// one by hand → Duet saves the manual → a fresh conversation follows it.
//   node scripts/e2e-manual.mjs
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { chromium } from 'playwright-core'

const PORT = 5177
const TOKEN = 'test-connector-token-manual-001'
const MCP_URL = `http://localhost:${PORT}/mcp/${TOKEN}`
const OUT = path.resolve('test-results/manual')
fs.mkdirSync(OUT, { recursive: true })
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-manual-'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log('[man]', ...a)
const failures = []
const check = (ok, label) => {
	log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
	if (!ok) failures.push(label)
}

const O = Array.from({ length: 17 }, (_, i) => [3 + 3 * Math.sin((i / 16) * 2 * Math.PI), 5 - 5 * Math.cos((i / 16) * 2 * Math.PI)])
const GLYPHS = {
	N: [[[0, 10], [0, 0], [6, 10], [6, 0]]],
	O: [O],
	C: [[[6, 1.5], [4, 0], [2, 0.3], [0.5, 2], [0, 5], [0.5, 8], [2, 9.7], [4, 10], [6, 8.5]]],
	A: [[[0, 10], [3, 0], [6, 10]], [[1.3, 6], [4.7, 6]]],
	L: [[[0, 0], [0, 10], [5, 10]]],
	S: [[[6, 1], [3, 0], [0.5, 1.5], [1, 4], [5, 5.8], [6, 8], [3, 10], [0, 8.8]]],
}

const server = spawn(path.resolve('node_modules/.bin/tsx'), ['server/index.ts'], {
	env: { ...process.env, PORT: String(PORT), PASSCODE: '535353', CONNECTOR_TOKEN: TOKEN, CANVAS_DATA_DIR: DATA },
	stdio: ['ignore', 'pipe', 'pipe'],
	detached: true,
})
server.stdout.pipe(fs.createWriteStream(path.join(OUT, 'server.log')))

const env = { ...process.env }
delete env.ANTHROPIC_API_KEY
for (const k of Object.keys(env)) if (/^(CLAUDECODE|CLAUDE_CODE_(ENTRYPOINT|SESSION_.*|CHILD_.*|MESSAGING_.*|EXECPATH)|CLAUDE_PID|CLAUDE_EFFORT)$/.test(k)) delete env[k]

async function fakeDuet(prompt) {
	const calls = []
	let answer = ''
	for await (const m of query({
		prompt,
		options: {
			model: 'sonnet',
			systemPrompt: "You are Claude Duet, the person's proactive personal assistant (EA / chief of staff). You chat with them in the Duet app and have a connector to their iPad canvas.",
			tools: [],
			mcpServers: { canvas: { type: 'http', url: MCP_URL } },
			allowedTools: ['look_at_canvas', 'show_template', 'show_page', 'show_board', 'annotate', 'move_view', 'get_page_guide', 'get_operating_manual', 'save_operating_manual'].map((t) => `mcp__canvas__${t}`),
			settingSources: [],
			strictMcpConfig: true,
			cwd: process.env.TMPDIR,
			env,
			maxTurns: 16,
		},
	})) {
		if (m.type === 'assistant') {
			for (const b of m.message.content) {
				if (b.type === 'tool_use') calls.push({ name: b.name.replace('mcp__canvas__', ''), input: b.input })
				if (b.type === 'text') answer += b.text
			}
		}
	}
	return { calls, answer }
}

let browser
try {
	for (let i = 0; i < 60; i++) {
		try {
			if ((await fetch(`http://localhost:${PORT}/api/config`)).ok) break
		} catch {}
		await sleep(500)
	}
	browser = await chromium.launch({ channel: 'chrome', headless: !process.env.HEADED })
	const context = await browser.newContext({ viewport: { width: 1180, height: 820 } })
	const page = await context.newPage()
	await page.goto(`http://localhost:${PORT}`)
	await page.fill('.auth-input', '535353')
	await page.click('.auth-button')
	await page.waitForFunction(() => window.editor && window.agent)
	await page.evaluate(() => {
		const e = window.editor
		e.deleteShapes([...e.getCurrentPageShapeIds()])
		e.setCamera({ x: 0, y: 0, z: 1 })
		e.setCurrentTool('draw')
	})
	await sleep(1000)

	// 1. Duet proposes the manual on the canvas.
	const r1 = await fakeDuet("Let's set up how you should work for me: approvals, my calendar, how you write, check-ins. Put it on my iPad so I can mark it up.")
	log('Duet (propose):', r1.calls.map((c) => `${c.name}${c.input?.template ? `(${c.input.template})` : ''}`).join(' → '))
	check(r1.calls.some((c) => c.name === 'get_operating_manual'), 'Duet checked for an existing manual first')
	const proposal = r1.calls.find((c) => c.name === 'show_template' && c.input?.template === 'operating_manual')
	check(!!proposal, 'Duet proposed rules on the operating_manual worksheet')
	await sleep(3000)
	await page.screenshot({ path: path.join(OUT, '1-proposed.png') })

	// 2. The person drops the first rule and writes a new one by hand.
	const firstSection = proposal.input.data.sections[0]
	const droppedRule = firstSection.rules[0]
	const iframe = (await page.$$('.html-page-shape iframe')).at(-1)
	await iframe.scrollIntoViewIfNeeded()
	await page.evaluate(() => {
		const e = window.editor
		const p = e.getCurrentPageShapes().find((s) => s.type === 'html-page')
		e.zoomToBounds(e.getShapePageBounds(p), { inset: 20 })
	})
	await sleep(700)
	const frame = await iframe.contentFrame()
	const ib = await iframe.boundingBox()
	const s = ib.width / 720
	const toScreen = (r) => ({ x: ib.x + r.x * s, y: ib.y + r.y * s, w: r.w * s, h: r.h * s })
	const drop = toScreen(await frame.evaluate(() => {
		const b = document.querySelector('[data-cc-option="Drop"]').getBoundingClientRect()
		return { x: b.x, y: b.y, w: b.width, h: b.height }
	}))
	const newLine = toScreen(await frame.evaluate(() => {
		const b = document.querySelector('[data-cc-region^="new-rules:"] .cc-line').getBoundingClientRect()
		return { x: b.x, y: b.y, w: b.width, h: b.height }
	}))
	const cdp = await context.newCDPSession(page)
	async function stroke(points) {
		const [f, ...rest] = points
		await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: f[0], y: f[1], button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen', force: 0.5 })
		for (const p of rest) await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p[0], y: p[1], button: 'left', buttons: 1, pointerType: 'pen', force: 0.6 })
		const l = points.at(-1)
		await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: l[0], y: l[1], button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen', force: 0 })
		await sleep(40)
	}
	const cx = drop.x + drop.w / 2
	const cy = drop.y + drop.h / 2
	await stroke(Array.from({ length: 25 }, (_, i) => [cx + (drop.w / 2 + 6) * Math.cos((i / 24) * 2 * Math.PI), cy + (drop.h / 2 + 5) * Math.sin((i / 24) * 2 * Math.PI)]))
	const unit = Math.max(1.6, (newLine.h * 0.9) / 10)
	let px = newLine.x + 6
	const py = newLine.y + newLine.h - 10 * unit - 2
	for (const ch of 'NO CALLS') {
		if (ch === ' ') {
			px += 6 * unit
			continue
		}
		for (const g of GLYPHS[ch]) {
			const pts = []
			for (let i = 0; i < g.length - 1; i++) for (let t = 0; t < 1; t += 0.25) pts.push([px + (g[i][0] + (g[i + 1][0] - g[i][0]) * t) * unit, py + (g[i][1] + (g[i + 1][1] - g[i][1]) * t) * unit])
			pts.push([px + g.at(-1)[0] * unit, py + g.at(-1)[1] * unit])
			await stroke(pts)
		}
		px += 8.5 * unit
	}
	await sleep(500)
	await page.screenshot({ path: path.join(OUT, '2-marked.png') })
	log(`dropped rule: "${droppedRule}"; wrote "NO CALLS" under ${firstSection.name}`)

	// 3. Duet folds the marks into the manual and saves it.
	const r2 = await fakeDuet("I marked up the operating manual on my iPad. Update it and save it.")
	log('Duet (save):', r2.calls.map((c) => c.name).join(' → '), '|', r2.answer.slice(-300).replace(/\n/g, ' '))
	const saved = r2.calls.find((c) => c.name === 'save_operating_manual')
	check(!!saved, 'Duet saved the manual')
	const file = fs.existsSync(path.join(DATA, 'operating-manual.md')) ? fs.readFileSync(path.join(DATA, 'operating-manual.md'), 'utf8') : ''
	fs.writeFileSync(path.join(OUT, 'saved-manual.md'), file)
	check(/no calls/i.test(file), 'the handwritten rule "NO CALLS" is in the saved manual')
	check(!file.includes(droppedRule), 'the dropped rule is gone')
	check(fs.existsSync(path.join(DATA, 'operating-manual-history')), 'a version is kept in history')

	// 4. A fresh conversation follows the manual.
	const r3 = await fakeDuet('Quick one: what rules are you following for me right now?')
	check(r3.calls.some((c) => c.name === 'get_operating_manual') && /no calls/i.test(r3.answer), 'a new conversation reads the manual and knows the new rule')
} catch (e) {
	console.error(e)
	failures.push(String(e?.message ?? e))
} finally {
	await browser?.close()
	try {
		process.kill(-server.pid, 'SIGTERM')
	} catch {}
	log(failures.length ? `${failures.length} FAILED: ${failures.join('; ')}` : 'ALL PASSED')
	process.exit(failures.length ? 1 : 0)
}
