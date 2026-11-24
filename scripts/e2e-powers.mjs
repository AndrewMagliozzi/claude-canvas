// End-to-end test of the three canvas-native features: movable boards,
// decision sweeps (batch approvals) and redlining documents by hand.
//   node scripts/e2e-powers.mjs
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { chromium } from 'playwright-core'

const PORT = 5179
const TOKEN = 'test-connector-token-powers-0001'
const MCP_URL = `http://localhost:${PORT}/mcp/${TOKEN}`
const OUT = path.resolve('test-results/powers')
fs.mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log('[pow]', ...a)
const failures = []
const check = (ok, label) => {
	log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
	if (!ok) failures.push(label)
}

const GLYPHS = {
	C: [[[6, 1.5], [4, 0], [2, 0.3], [0.5, 2], [0, 5], [0.5, 8], [2, 9.7], [4, 10], [6, 8.5]]],
	A: [[[0, 10], [3, 0], [6, 10]], [[1.3, 6], [4.7, 6]]],
	L: [[[0, 0], [0, 10], [5, 10]]],
}

const server = spawn(path.resolve('node_modules/.bin/tsx'), ['server/index.ts'], {
	env: { ...process.env, PORT: String(PORT), PASSCODE: '595959', CONNECTOR_TOKEN: TOKEN },
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
			systemPrompt:
				"You are Claude Duet, the person's proactive personal assistant (EA / chief of staff). You chat with them in the Duet app and have a connector to their iPad canvas. In this test you have no email or calendar tools: when you'd send or book something, ask for confirmation as you normally would.",
			tools: [],
			mcpServers: { canvas: { type: 'http', url: MCP_URL } },
			allowedTools: ['look_at_canvas', 'show_template', 'show_page', 'show_board', 'annotate', 'move_view', 'get_page_guide'].map((t) => `mcp__canvas__${t}`),
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

const lookData = async (mcp) => {
	const r = await mcp.callTool({ name: 'look_at_canvas', arguments: { includeScreenshot: false } })
	return JSON.parse(r.content.find((x) => x.type === 'text' && x.text.startsWith('{')).text)
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
	await page.fill('.auth-input', '595959')
	await page.click('.auth-button')
	await page.waitForFunction(() => window.editor && window.agent)
	const clear = () =>
		page.evaluate(() => {
			const e = window.editor
			e.updateShapes(e.getCurrentPageShapes().map((s) => ({ id: s.id, type: s.type, isLocked: false })))
			e.deleteShapes([...e.getCurrentPageShapeIds()])
			e.setCamera({ x: 0, y: 0, z: 1 })
		})
	await clear()
	await sleep(1000)
	const mcp = new Client({ name: 'e2e', version: '1' })
	await mcp.connect(new StreamableHTTPClientTransport(new URL(MCP_URL)))
	const cdp = await context.newCDPSession(page)
	async function stroke(points) {
		const [f, ...rest] = points
		await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: f[0], y: f[1], button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen', force: 0.5 })
		for (const p of rest) await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p[0], y: p[1], button: 'left', buttons: 1, pointerType: 'pen', force: 0.6 })
		const l = points.at(-1)
		await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: l[0], y: l[1], button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen', force: 0 })
		await sleep(50)
	}
	/** Screen rect of an element inside the (only/last) page iframe. */
	async function rectIn(selectorOrFn) {
		const handles = await page.$$('.html-page-shape iframe')
		const iframe = handles.at(-1)
		const frame = await iframe.contentFrame()
		const ib = await iframe.boundingBox()
		const s = ib.width / 720
		const r = await frame.evaluate(selectorOrFn)
		return { x: ib.x + r.x * s, y: ib.y + r.y * s, w: r.w * s, h: r.h * s, s }
	}
	const circleAround = (r) => {
		const cx = r.x + r.w / 2
		const cy = r.y + r.h / 2
		return Array.from({ length: 25 }, (_, i) => [cx + (r.w / 2 + 6) * Math.cos((i / 24) * 2 * Math.PI), cy + (r.h / 2 + 5) * Math.sin((i / 24) * 2 * Math.PI)])
	}
	await page.evaluate(() => {
		window.editor.setCurrentTool('draw')
	})

	// ================= 1. Movable board =================
	const board = {
		boardId: 'week',
		title: 'This week',
		layout: 'columns',
		zones: ['To do', 'Doing', 'Done'],
		cards: [
			{ id: 'charter', title: 'Charter owner', detail: 'Decide with Marcus', zone: 'To do' },
			{ id: 'gates', title: 'Lakeview funding ask', zone: 'To do' },
			{ id: 'pricing', title: 'Pricing doc', zone: 'Done' },
		],
	}
	await mcp.callTool({ name: 'show_board', arguments: board })
	await sleep(1200)
	const b0 = await lookData(mcp)
	check(b0.boards?.[0]?.zones?.['To do']?.length === 2 && b0.boards[0].zones['Done'].length === 1, 'the board is laid out with cards in their zones')
	// Drag "Charter owner" into "Done", the way a person would.
	await page.evaluate(() => {
		const e = window.editor
		const done = e.getShape('shape:board-week-zone-2')
		const b = e.getShapePageBounds(done)
		e.updateShape({ id: 'shape:card-week-charter', type: 'geo', x: b.x + 12, y: b.y + 150 })
	})
	await page.screenshot({ path: path.join(OUT, '1-board-moved.png') })
	const b1 = await lookData(mcp)
	log('cardsThePersonMoved:', JSON.stringify(b1.cardsThePersonMoved))
	check(b1.cardsThePersonMoved?.some((m) => m.cardId === 'charter' && m.from === 'To do' && m.to === 'Done'), 'dragging a card is reported as a move from "To do" to "Done"')
	const b2 = await lookData(mcp)
	check(!b2.cardsThePersonMoved, 'a move is reported once')
	await mcp.callTool({ name: 'show_board', arguments: { ...board, focus: false } })
	const b3 = await lookData(mcp)
	check(b3.boards[0].zones['Done'].includes('Charter owner'), "Duet updating the board keeps the person's placement")
	await mcp.callTool({ name: 'show_board', arguments: { ...board, focus: false, cards: [{ ...board.cards[1], zone: 'Doing' }] } })
	const b4 = await lookData(mcp)
	check(b4.boards[0].zones['Doing'].includes('Lakeview funding ask'), 'Duet can still move a card it reassigns')

	// ================= 2. Decision sweep =================
	await clear()
	await sleep(400)
	await lookData(mcp)
	await mcp.callTool({
		name: 'show_template',
		arguments: {
			template: 'approvals_sweep',
			data: {
				items: [
					{ what: 'Send advising-terms note to Priya', detail: 'Tuesday Dec 1, 1:45pm, Leo cc’d' },
					{ what: 'Accept Thursday 2pm with Maurice' },
					{ what: 'Pay Fernwood Legal invoice #2231 ($450)' },
					{ what: 'Decline the ProductHunt podcast' },
				],
			},
		},
	})
	await sleep(2500)
	await lookData(mcp)
	await stroke(circleAround(await rectIn(() => {
		const b = document.querySelector('[data-cc-question^="1."] [data-cc-option="Approve"]').getBoundingClientRect()
		return { x: b.x, y: b.y, w: b.width, h: b.height }
	})))
	await stroke(circleAround(await rectIn(() => {
		const b = document.querySelector('[data-cc-question^="3."] [data-cc-option="Skip"]').getBoundingClientRect()
		return { x: b.x, y: b.y, w: b.width, h: b.height }
	})))
	await stroke(circleAround(await rectIn(() => {
		const b = document.querySelector('[data-cc-question^="4."] [data-cc-option="Approve"]').getBoundingClientRect()
		return { x: b.x, y: b.y, w: b.width, h: b.height }
	})))
	await sleep(400)
	await page.screenshot({ path: path.join(OUT, '2-sweep-marked.png') })
	// Duet looks first (as it would), then the test checks the same answers.
	const sweepDuet = await fakeDuet('I went through the sweep on my iPad. Take it from here.')
	log('Duet (sweep):', sweepDuet.calls.map((c) => c.name).join(' → '), '|', sweepDuet.answer.slice(-600).replace(/\n/g, ' '))
	check(/priya/i.test(sweepDuet.answer) && /podcast|producthunt/i.test(sweepDuet.answer) && /clerky/i.test(sweepDuet.answer), 'Duet summarised every marked item')
	check((sweepDuet.answer.match(/\?/g) ?? []).length >= 1 && /(yes|confirm)/i.test(sweepDuet.answer), 'Duet asked to confirm before acting')
	const s1 = await lookData(mcp)
	const ans = (s1.answersMarkedOnPages ?? []).map((a) => `${a.question} → ${a.answer}`)
	log('sweep answers:', JSON.stringify(ans), 'keys:', Object.keys(s1).join(','), 'marks:', JSON.stringify(s1.marksOnPages).slice(0, 600))
	check(ans.some((a) => /^1\. Send advising.*→ Approve$/.test(a)) && ans.some((a) => /^3\. Pay Fernwood Legal.*→ Skip$/.test(a)) && ans.some((a) => /^4\. Decline.*→ Approve$/.test(a)), 'every circled row in the sweep comes back as its own answer')

	// ================= 3. Redlines =================
	await clear()
	await sleep(400)
	await lookData(mcp)
	await mcp.callTool({
		name: 'show_template',
		arguments: {
			template: 'document_markup',
			data: {
				title: 'Note to the board',
				kind: 'Memo draft',
				paragraphs: [
					'We propose to close the round on Friday, with Maurice leading and two angels joining.',
					'The charter will be drafted by Fernwood Legal using their standard template, which keeps costs low.',
					'Questions about option-pool will be handled after closing.',
				],
			},
		},
	})
	await sleep(2500)
	await lookData(mcp)
	// Strike "standard" in ¶2.
	const word = await rectIn(() => {
		const p = document.querySelector('[data-cc-region="para:2"]')
		const node = p.firstChild
		const i = node.data.indexOf('standard')
		const r = document.createRange()
		r.setStart(node, i)
		r.setEnd(node, i + 'standard'.length)
		const b = r.getBoundingClientRect()
		return { x: b.x, y: b.y, w: b.width, h: b.height }
	})
	await stroke(Array.from({ length: 12 }, (_, i) => [word.x - 2 + ((word.w + 4) * i) / 11, word.y + word.h * 0.55 + (i % 2 ? 0.6 : -0.6)]))
	// Write "CALL" in the margin of ¶3.
	const margin = await rectIn(() => {
		const b = document.querySelector('[data-cc-region="margin:3"]').getBoundingClientRect()
		return { x: b.x, y: b.y, w: b.width, h: b.height }
	})
	const unit = 2.4 * margin.s
	let px = margin.x + 14
	const py = margin.y + 12
	for (const ch of 'CALL') {
		for (const s of GLYPHS[ch]) {
			const pts = []
			for (let i = 0; i < s.length - 1; i++) for (let t = 0; t < 1; t += 0.2) pts.push([px + (s[i][0] + (s[i + 1][0] - s[i][0]) * t) * unit, py + (s[i][1] + (s[i + 1][1] - s[i][1]) * t) * unit])
			pts.push([px + s.at(-1)[0] * unit, py + s.at(-1)[1] * unit])
			await stroke(pts)
		}
		px += 8.5 * unit
	}
	await sleep(400)
	await page.screenshot({ path: path.join(OUT, '3-redlined.png') })
	const r1 = await mcp.callTool({ name: 'look_at_canvas', arguments: { includeScreenshot: false } })
	const rd = JSON.parse(r1.content.find((x) => x.type === 'text' && x.text.startsWith('{')).text)
	log('edits:', JSON.stringify(rd.editsMarkedOnDocuments), 'keys:', Object.keys(rd).join(','), 'marks:', JSON.stringify(rd.marksOnPages).slice(0, 800))
	check(rd.editsMarkedOnDocuments?.some((e) => e.paragraph === 2 && /delete/.test(e.meaning) && e.words === 'standard'), 'a strike-through comes back as "delete \'standard\'" in ¶2')
	check(rd.editsMarkedOnDocuments?.some((e) => e.paragraph === 3 && e.meaning === 'margin note' && /call/i.test(e.handwriting ?? '')), 'a margin note comes back on ¶3 with its handwriting transcribed')
	await mcp.close()

	const redDuet = await fakeDuet('I marked up the board memo on my iPad. Apply my edits and show me the revised version there.')
	log('Duet (redlines):', redDuet.calls.map((c) => c.name).join(' → '), '|', redDuet.answer.slice(-400).replace(/\n/g, ' '))
	const revised = redDuet.calls.filter((c) => c.name === 'show_template' || c.name === 'show_page').at(-1)
	const revisedText = JSON.stringify(revised?.input ?? {})
	check(!!revised && /Fernwood Legal/.test(revisedText) && !/standard template/.test(revisedText), 'Duet applied the strike and showed the revised memo')
	await sleep(2500)
	await page.screenshot({ path: path.join(OUT, '4-revised.png') })
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
