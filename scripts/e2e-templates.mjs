// Tests templates, Pencil answers and chief-of-staff behaviour through the connector.
//   node scripts/e2e-templates.mjs
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { chromium } from 'playwright-core'

const PORT = 5183
const PASSCODE = '717171'
const TOKEN = 'test-connector-token-templates-01'
const OUT = path.resolve('test-results/templates')
fs.mkdirSync(OUT, { recursive: true })
const MCP_URL = `http://localhost:${PORT}/mcp/${TOKEN}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log('[tpl]', ...a)
const failures = []
const check = (ok, label) => {
	log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
	if (!ok) failures.push(label)
}

const server = spawn(path.resolve('node_modules/.bin/tsx'), ['server/index.ts'], {
	env: { ...process.env, PORT: String(PORT), PASSCODE, CONNECTOR_TOKEN: TOKEN },
	stdio: ['ignore', 'pipe', 'pipe'],
	detached: true,
})
server.stdout.pipe(fs.createWriteStream(path.join(OUT, 'server.log')))

const env = { ...process.env }
delete env.ANTHROPIC_API_KEY
for (const k of Object.keys(env)) if (/^(CLAUDECODE|CLAUDE_CODE_(ENTRYPOINT|SESSION_.*|CHILD_.*|MESSAGING_.*|EXECPATH)|CLAUDE_PID|CLAUDE_EFFORT)$/.test(k)) delete env[k]

/** A Claude session with only the connector, standing in for Duet. */
async function fakeDuet(prompt) {
	const calls = []
	let answer = ''
	for await (const m of query({
		prompt,
		options: {
			model: 'sonnet',
			systemPrompt:
				"You are Claude Duet, the person's proactive personal assistant (EA / chief of staff). You chat with them in the Duet app. You have a connector to their iPad canvas. In this test you have no email or calendar tools: when you would send or book something, ask for confirmation as you normally would.",
			tools: [],
			mcpServers: { canvas: { type: 'http', url: MCP_URL } },
			allowedTools: ['mcp__canvas__look_at_canvas', 'mcp__canvas__show_template', 'mcp__canvas__show_page', 'mcp__canvas__annotate', 'mcp__canvas__move_view', 'mcp__canvas__get_page_guide'],
			settingSources: [],
			strictMcpConfig: true,
			cwd: process.env.TMPDIR,
			env,
			maxTurns: 14,
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
	page.on('pageerror', (e) => log('page error:', String(e).slice(0, 300)))
	await page.goto(`http://localhost:${PORT}`)
	await page.fill('.auth-input', PASSCODE)
	await page.click('.auth-button')
	await page.waitForFunction(() => window.editor && window.agent)
	await page.evaluate(() => {
		const e = window.editor
		e.deleteShapes([...e.getCurrentPageShapeIds()])
		e.setCamera({ x: 0, y: 0, z: 1 })
	})
	await sleep(1000)

	const mcp = new Client({ name: 'e2e', version: '1' })
	await mcp.connect(new StreamableHTTPClientTransport(new URL(MCP_URL)))

	// ---- show_template + validation ----
	const bad = await mcp.callTool({ name: 'show_template', arguments: { template: 'email_draft', data: { to: 'Priya' } } })
	check(bad.isError && /subject/.test(bad.content[0].text), 'show_template explains missing fields')
	const shown = await mcp.callTool({
		name: 'show_template',
		arguments: {
			template: 'email_draft',
			data: { to: 'Priya', cc: 'Leo', subject: 'Advising terms for Tuesday', body: 'Hi Priya,\n\nTuesday Dec 1 at 1:45pm works for me.\n\nBest,\nAlex' },
		},
	})
	const pageId = JSON.parse(shown.content[0].text).pageId
	await sleep(2500)
	await page.screenshot({ path: path.join(OUT, '1-email-template.png') })

	// ---- Pencil: circle "Send with edits", write in the tray ----
	const cdp = await context.newCDPSession(page)
	async function stroke(points) {
		const [f, ...rest] = points
		await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: f[0], y: f[1], button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen', force: 0.5 })
		for (const p of rest) await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p[0], y: p[1], button: 'left', buttons: 1, pointerType: 'pen', force: 0.6 })
		const l = points.at(-1)
		await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: l[0], y: l[1], button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen', force: 0 })
		await sleep(80)
	}
	const iframeHandle = await page.waitForSelector('.html-page-shape iframe')
	const frame = await iframeHandle.contentFrame()
	const iframeBox = await iframeHandle.boundingBox()
	const scale = iframeBox.width / 720
	const rectOf = async (selector) => {
		const r = await frame.evaluate((sel) => {
			const el = document.querySelector(sel)
			const b = el.getBoundingClientRect()
			return { x: b.x, y: b.y, w: b.width, h: b.height }
		}, selector)
		return { x: iframeBox.x + r.x * scale, y: iframeBox.y + r.y * scale, w: r.w * scale, h: r.h * scale }
	}
	await page.evaluate(() => {
		window.editor.setCurrentTool('draw')
	})
	const tile = await rectOf('[data-cc-option="Send with edits"]')
	const cx = tile.x + tile.w / 2
	const cy = tile.y + tile.h / 2
	await stroke(Array.from({ length: 25 }, (_, i) => [cx + (tile.w / 2 + 6) * Math.cos((i / 24) * 2 * Math.PI), cy + (tile.h / 2 + 4) * Math.sin((i / 24) * 2 * Math.PI)]))
	const tray = await rectOf('[data-cc-region="tray"]')
	const tx = tray.x + 30
	const ty = tray.y + tray.h * 0.4
	await stroke(Array.from({ length: 14 }, (_, i) => [tx + i * 14, ty + (i % 2 ? -8 : 8)]))
	await sleep(500)
	await page.screenshot({ path: path.join(OUT, '2-marked.png') })

	const look = await mcp.callTool({ name: 'look_at_canvas', arguments: { includeScreenshot: false } })
	const data = JSON.parse(look.content.find((x) => x.type === 'text').text)
	log('answers:', JSON.stringify(data.answersMarkedOnPages))
	log('requests:', JSON.stringify(data.newRequestsInTrays))
	const ans = data.answersMarkedOnPages?.find((a) => a.answer === 'Send with edits')
	check(!!ans && /Priya/.test(ans.question ?? ''), 'a circled choice comes back as an answer to the right question')
	check(!!ans?.actsOutsideTheCanvas, 'a "send" answer is flagged for confirmation in chat')
	check(data.newRequestsInTrays?.some((r) => r.isNew), 'writing in the tray comes back as a new request')
	const look2 = await mcp.callTool({ name: 'look_at_canvas', arguments: { includeScreenshot: false } })
	const data2 = JSON.parse(look2.content.find((x) => x.type === 'text').text)
	check(data2.answersMarkedOnPages?.every((a) => !a.isNew), 'answers are only flagged new once')
	await mcp.close()

	// ---- Fake Duet 1: acting on the marks must ask explicitly first ----
	const r1 = await fakeDuet('Check my iPad.')
	log('Duet (check iPad):', r1.calls.map((c) => c.name).join(' → '), '|', r1.answer.slice(-400).replace(/\n/g, ' '))
	check(r1.calls.some((c) => c.name === 'look_at_canvas'), 'Duet looked at the canvas')
	check(/priya/i.test(r1.answer) && /\?/.test(r1.answer) && /(send|confirm)/i.test(r1.answer), 'Duet asked explicitly before sending the email to Priya')

	// ---- Fake Duet 2: a template from real-looking data ----
	const r2 = await fakeDuet(
		"Here's my calendar for today (Mon Nov 23): 9:30 call with Marcus about the charter and option pool; 1:00 lunch with Leo; 3:30 board prep. Pending: Priya's advising-terms note needs my OK. Set me up for the morning on my iPad."
	)
	log('Duet (morning):', r2.calls.map((c) => `${c.name}${c.input?.template ? `(${c.input.template})` : ''}`).join(' → '))
	check(r2.calls.some((c) => c.name === 'show_template' && c.input?.template === 'daily_brief'), 'Duet used the daily_brief template for the morning')

	// ---- Fake Duet 3: a template designed on the fly ----
	await page.evaluate(() => {
		const e = window.editor
		e.deleteShapes([...e.getCurrentPageShapeIds()])
	})
	const r3 = await fakeDuet(
		"I'm going to New York Thursday–Friday for the Lakeview Fund meeting (Fri 10am, Midtown). Options I found: Hotel A $420/night next to the venue, Hotel B $310/night 20 min away; Amtrak Thu 7:05am or 4:05pm. Put something on my iPad so I can choose with my pencil."
	)
	log('Duet (trip):', r3.calls.map((c) => c.name).join(' → '))
	const custom = r3.calls.find((c) => c.name === 'show_page')
	check(!!custom, 'Duet designed a page on the fly when no template fit')
	check(!!custom && /cc-(page|choice|box)/.test(custom.input.html ?? ''), 'the on-the-fly page uses the design kit')
	check(!!custom && /data-cc-option/.test(custom.input.html ?? ''), 'the on-the-fly page makes choices machine-readable')
	await sleep(2500)
	await page.screenshot({ path: path.join(OUT, '3-trip-page.png') })
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
