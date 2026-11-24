// End-to-end test of the Claude connector (for Claude Duet, Claude chat, Claude Code).
//
// 1. Opens the canvas in Chrome and leaves a "handwritten" note.
// 2. Calls the MCP endpoint directly with an MCP client (tools, look, page, annotate, auth).
// 3. Plays Duet: a real Claude session (Agent SDK) whose only tools are this connector
//    is asked to read the iPad notes and put an agenda page next to them.
//
//   node scripts/e2e-duet.mjs
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { chromium } from 'playwright-core'

const PORT = 5185
const PASSCODE = '858585'
const TOKEN = 'test-connector-token-0123456789'
const OUT = path.resolve('test-results/duet')
fs.mkdirSync(OUT, { recursive: true })
const MCP_URL = `http://localhost:${PORT}/mcp/${TOKEN}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log('[duet]', ...a)
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
const slog = fs.createWriteStream(path.join(OUT, 'server.log'))
server.stdout.pipe(slog)
server.stderr.pipe(slog)

async function mcpClient(url = MCP_URL) {
	const client = new Client({ name: 'e2e', version: '1.0.0' })
	await client.connect(new StreamableHTTPClientTransport(new URL(url)))
	return client
}

let browser
try {
	for (let i = 0; i < 60; i++) {
		try {
			if ((await fetch(`http://localhost:${PORT}/api/config`)).ok) break
		} catch {}
		await sleep(500)
	}

	// ---- Canvas not open yet ----
	{
		const c = await mcpClient()
		const r = await c.callTool({ name: 'look_at_canvas', arguments: {} })
		check(/isn't open/.test(r.content?.[0]?.text ?? ''), 'with no canvas open, look_at_canvas says so politely')
		await c.close()
	}

	// ---- Open the canvas, leave a handwritten-style note ----
	browser = await chromium.launch({ channel: 'chrome', headless: !process.env.HEADED })
	const page = await (await browser.newContext({ viewport: { width: 1180, height: 820 } })).newPage()
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
	await sleep(1500) // bridge connects
	await page.evaluate(() => {
		const e = window.editor
		// Stand-in for Pencil handwriting: text in tldraw's hand-drawn font, made by the person.
		e.createShape({
			type: 'text',
			x: 120,
			y: 160,
			props: {
				richText: window.__toRichText('Wed call w/ Marcus:\n- who drafts the charter?\n- ask about option pool first!\n- Fernwood Legal still silent'),
				font: 'draw',
				size: 'l',
			},
		})
	})

	// ---- Direct MCP checks ----
	const c = await mcpClient()
	const tools = (await c.listTools()).tools.map((t) => t.name).sort()
	log('tools:', tools.join(', '))
	check(['annotate', 'get_page_guide', 'look_at_canvas', 'move_view', 'show_page'].every((t) => tools.includes(t)), 'connector lists its five tools')

	const look = await c.callTool({ name: 'look_at_canvas', arguments: {} })
	const img = look.content.find((x) => x.type === 'image')
	const data = JSON.parse(look.content.find((x) => x.type === 'text').text)
	if (img) fs.writeFileSync(path.join(OUT, 'look-1.jpg'), Buffer.from(img.data, 'base64'))
	check(!!img && img.data.length > 1000, 'look_at_canvas returns a screenshot')
	check(data.changesSinceYouLastLooked?.added?.length >= 1, 'look_at_canvas reports what the person added since the last look')
	check(data.shapesInView?.some((s) => s.by === 'person' && /option pool/.test(s.text ?? '')), 'look_at_canvas includes the note text and who made it')
	const look2 = await c.callTool({ name: 'look_at_canvas', arguments: { includeScreenshot: false } })
	const data2 = JSON.parse(look2.content.find((x) => x.type === 'text').text)
	check((data2.changesSinceYouLastLooked?.added?.length ?? 0) === 0, 'a second look reports no new changes')

	const shown = await c.callTool({
		name: 'show_page',
		arguments: { title: 'Probe', html: '<body style="margin:0;padding:24px;font:16px sans-serif">Probe page</body>', width: 360, heightEstimate: 120 },
	})
	const shownData = JSON.parse(shown.content[0].text)
	await sleep(1500)
	const probe = await page.evaluate((id) => {
		const s = window.editor.getShape('shape:' + id)
		return s ? { by: s.meta?.by, html: s.props.html.length, x: s.x, y: s.y } : null
	}, shownData.pageId)
	check(!!probe && probe.by === 'duet' && probe.html > 10, `show_page puts a page on the canvas, tagged as Duet's (${JSON.stringify(probe)})`)
	check(probe && probe.x > 120, 'auto-placement put the page beside the note, not on top of it')

	const ann = await c.callTool({
		name: 'annotate',
		arguments: { items: [{ kind: 'text', x: 120, y: 120, text: 'probe note', id: 'probe-note' }, { kind: 'delete', shapeId: shownData.pageId }] },
	})
	await sleep(300)
	const annState = await page.evaluate((pid) => ({
		note: !!window.editor.getShape('shape:probe-note'),
		pageGone: !window.editor.getShape('shape:' + pid),
	}), shownData.pageId)
	check(annState.note && annState.pageGone, `annotate adds notes and deletes shapes (${ann.content[0].text.slice(0, 120)})`)
	await page.evaluate(() => {
		window.editor.deleteShapes(['shape:probe-note'])
	})
	await c.close()

	const bad = await fetch(`http://localhost:${PORT}/mcp/wrong-token`, { method: 'POST', body: '{}' })
	check(bad.status === 404, 'a wrong connector token gets 404')

	// ---- Play Duet: a real Claude with only the connector's tools ----
	const env = { ...process.env }
	delete env.ANTHROPIC_API_KEY
	for (const k of Object.keys(env)) if (/^(CLAUDECODE|CLAUDE_CODE_(ENTRYPOINT|SESSION_.*|CHILD_.*|MESSAGING_.*|EXECPATH)|CLAUDE_PID|CLAUDE_EFFORT)$/.test(k)) delete env[k]
	const toolCalls = []
	let answer = ''
	const t0 = Date.now()
	for await (const m of query({
		prompt:
			"I jotted notes on my iPad for Wednesday's call with Marcus. Check them, then put a tidy agenda page next to them that I can tick off during the call. Reply briefly in chat.",
		options: {
			model: 'sonnet',
			systemPrompt:
				"You are Claude Duet, the person's proactive personal assistant. You message them in a chat app. You have a connector to their iPad canvas; use it whenever they mention the iPad or their notes.",
			tools: [],
			mcpServers: { canvas: { type: 'http', url: MCP_URL } },
			allowedTools: ['mcp__canvas__look_at_canvas', 'mcp__canvas__show_page', 'mcp__canvas__annotate', 'mcp__canvas__move_view', 'mcp__canvas__get_page_guide'],
			settingSources: [],
			strictMcpConfig: true,
			cwd: process.env.TMPDIR,
			env,
			maxTurns: 12,
		},
	})) {
		if (m.type === 'assistant') {
			for (const b of m.message.content) {
				if (b.type === 'tool_use') toolCalls.push(b.name.replace('mcp__canvas__', ''))
				if (b.type === 'text') answer += b.text
			}
		}
		if (m.type === 'result') log(`fake Duet finished in ${((Date.now() - t0) / 1000).toFixed(1)}s, $${m.total_cost_usd?.toFixed(3)}`)
	}
	log('Duet tool calls:', toolCalls.join(' → '))
	log('Duet chat reply:', answer.slice(-500))
	await sleep(2000)
	await page.screenshot({ path: path.join(OUT, 'after-duet.png') })
	const final = await page.evaluate(() =>
		window.editor
			.getCurrentPageShapes()
			.filter((s) => s.type === 'html-page')
			.map((s) => ({ by: s.meta?.by, title: s.props.title, html: s.props.html }))
	)
	check(toolCalls.includes('look_at_canvas'), 'Duet looked at the canvas')
	check(final.some((p) => p.by === 'duet' && /option pool/i.test(p.html) && /charter/i.test(p.html)), 'Duet put an agenda page on the canvas built from the handwritten notes')
	check(/agenda|ipad|canvas/i.test(answer), 'Duet mentioned the canvas in its chat reply')
	const localNotes = await page.evaluate(() => window.agent.takeNotes())
	check(localNotes.some((n) => /Claude Duet/.test(n)), "the canvas's own Claude is told what Duet changed")
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
