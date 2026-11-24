// Runs a set of prompts, each in a fresh conversation on a blank canvas, and
// saves a screenshot of Claude's reply. Used to test and improve PAGE_GUIDE.md.
//   node scripts/guide-trial.mjs [index ...]
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'

const PORT = 5193
const PASSCODE = '262626'
const OUT = path.resolve('test-results/guide')
fs.mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const TRIALS = [
	{ name: 'handwritten-math', handwriting: 'What is 17 × 24 ?', text: '' },
	{ name: 'worksheet', text: 'Make me something to practice adding fractions. I am 10.' },
	{ name: 'comparison', text: 'Train, bus, car or plane from Boston to New York — which should I pick?' },
	{ name: 'diagram', text: 'How does a heat pump heat a house in winter?' },
	{ name: 'letter', text: "I'm nervous about starting a new job on Monday. Any advice?" },
	{ name: 'checklist-form', text: 'Packing for a 3-day camping trip. Give me a checklist.' },
]

const server = spawn('npx', ['tsx', 'server/index.ts'], {
	env: { ...process.env, PORT: String(PORT), PASSCODE, DEBUG_CLAUDE: '1' },
	stdio: ['ignore', 'pipe', 'pipe'],
})
const slog = fs.createWriteStream(path.join(OUT, 'server.log'))
server.stdout.pipe(slog)
server.stderr.pipe(slog)
const pick = process.argv.slice(2).map(Number)
let browser
try {
	for (let i = 0; i < 60; i++) {
		try {
			if ((await fetch(`http://localhost:${PORT}/api/config`)).ok) break
		} catch {}
		await sleep(500)
	}
	browser = await chromium.launch({ channel: 'chrome' })
	const context = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1 })
	const page = await context.newPage()
	await page.goto(`http://localhost:${PORT}`)
	await page.fill('.auth-input', PASSCODE)
	await page.click('.auth-button')
	await page.waitForFunction(() => window.editor && window.agent)
	await page.evaluate(async () => {
		window.__state = await import('/client/state.ts')

	})
	for (const [i, t] of TRIALS.entries()) {
		if (pick.length && !pick.includes(i)) continue
		await page.evaluate((t) => {
			const e = window.editor
			e.deleteShapes([...e.getCurrentPageShapeIds()])
			window.agent.reset()
			e.setCamera({ x: 0, y: 0, z: 1 })
			if (t.handwriting) {
				// Stand-in for handwriting: text in tldraw's hand-drawn font, made "by the user".
				e.createShape({
					type: 'text',
					x: 160,
					y: 240,
					props: { richText: window.__toRichText(t.handwriting), font: 'draw', size: 'xl' },
				})
			}
			window.__state.setDraft(t.text)
		}, t)
		const t0 = Date.now()
		await page.click('.send-button')
		await page.waitForFunction(() => window.agent.requests.isGenerating(), null, { timeout: 15000 })
		await page.waitForFunction(() => !window.agent.requests.isGenerating(), null, { timeout: 300000, polling: 300 })
		await sleep(1500)
		const info = await page.evaluate(() => ({
			turn: window.agent.$lastTurn.get(),
			actions: window.agent.chat
				.getHistory()
				.filter((h) => h.type === 'action')
				.map((h) => h.action._type),
		}))
		console.log(
			`${t.name}: ${((Date.now() - t0) / 1000).toFixed(1)}s, $${info.turn?.costUsd?.toFixed?.(3) ?? '?'} ${info.turn?.error ?? ''} actions=${info.actions.join(',')}`
		)
		await page.screenshot({ path: path.join(OUT, `${i}-${t.name}.png`) })
	}
} catch (e) {
	console.error(e)
} finally {
	await browser?.close()
	server.kill('SIGTERM')
}
