// Tests handwriting transcription: writes "CALL ANNA" with simulated Pencil strokes
// in the Hand-to-Duet tray, then checks look_at_canvas returns the words.
//   node scripts/e2e-handwriting.mjs
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { chromium } from 'playwright-core'

const PORT = 5181
const TOKEN = 'test-connector-token-handwriting'
const OUT = path.resolve('test-results/handwriting')
fs.mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log('[hw]', ...a)
const failures = []
const check = (ok, label) => {
	log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
	if (!ok) failures.push(label)
}

// Block capitals as pen strokes on a 6×10 grid (y down).
const GLYPHS = {
	C: [[[6, 1.5], [4, 0], [2, 0.3], [0.5, 2], [0, 5], [0.5, 8], [2, 9.7], [4, 10], [6, 8.5]]],
	A: [[[0, 10], [3, 0], [6, 10]], [[1.3, 6], [4.7, 6]]],
	L: [[[0, 0], [0, 10], [5, 10]]],
	N: [[[0, 10], [0, 0], [6, 10], [6, 0]]],
}

const server = spawn(path.resolve('node_modules/.bin/tsx'), ['server/index.ts'], {
	env: { ...process.env, PORT: String(PORT), PASSCODE: '676767', CONNECTOR_TOKEN: TOKEN },
	stdio: ['ignore', 'pipe', 'pipe'],
	detached: true,
})
server.stdout.pipe(fs.createWriteStream(path.join(OUT, 'server.log')))
server.stderr.pipe(fs.createWriteStream(path.join(OUT, 'server.err.log')))

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
	await page.fill('.auth-input', '676767')
	await page.click('.auth-button')
	await page.waitForFunction(() => window.editor && window.agent)
	await page.evaluate(() => {
		const e = window.editor
		e.deleteShapes([...e.getCurrentPageShapeIds()])
		e.setCamera({ x: 0, y: 0, z: 1 })
	})
	await sleep(1000)

	const mcp = new Client({ name: 'e2e', version: '1' })
	await mcp.connect(new StreamableHTTPClientTransport(new URL(`http://localhost:${PORT}/mcp/${TOKEN}`)))
	await mcp.callTool({
		name: 'show_template',
		arguments: { template: 'email_draft', data: { to: 'Priya', subject: 'Advising terms', body: 'Hi Priya,\n\nTuesday works.\n\nBest,\nAlex' } },
	})
	await sleep(2500)
	// Clear "since last look" so only the handwriting below is new.
	await mcp.callTool({ name: 'look_at_canvas', arguments: { includeScreenshot: false } })

	const iframe = await page.waitForSelector('.html-page-shape iframe')
	const frame = await iframe.contentFrame()
	const ib = await iframe.boundingBox()
	const scale = ib.width / 720
	const tray = await frame.evaluate(() => {
		const b = document.querySelector('[data-cc-region="tray"]').getBoundingClientRect()
		return { x: b.x, y: b.y, w: b.width, h: b.height }
	})

	const cdp = await context.newCDPSession(page)
	const jitter = () => (Math.random() - 0.5) * 0.35
	async function stroke(points) {
		const [f, ...rest] = points
		await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: f[0], y: f[1], button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen', force: 0.5 })
		for (const p of rest) await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p[0], y: p[1], button: 'left', buttons: 1, pointerType: 'pen', force: 0.6 })
		const l = points.at(-1)
		await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: l[0], y: l[1], button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen', force: 0 })
		await sleep(40)
	}
	await page.evaluate(() => {
		window.editor.setCurrentTool('draw')
	})
	const unit = 2.6 * scale // grid unit → screen px (letters ~26 canvas px tall)
	let penX = ib.x + (tray.x + 30) * scale
	const baseY = ib.y + (tray.y + tray.h * 0.32) * scale
	for (const ch of 'CALL ANNA') {
		if (ch === ' ') {
			penX += 6 * unit
			continue
		}
		for (const s of GLYPHS[ch]) {
			// Densify each segment so it draws like a real stroke.
			const pts = []
			for (let i = 0; i < s.length - 1; i++) {
				for (let t = 0; t < 1; t += 0.2) {
					pts.push([penX + (s[i][0] + (s[i + 1][0] - s[i][0]) * t + jitter()) * unit, baseY + (s[i][1] + (s[i + 1][1] - s[i][1]) * t + jitter()) * unit])
				}
			}
			const last = s.at(-1)
			pts.push([penX + last[0] * unit, baseY + last[1] * unit])
			await stroke(pts)
		}
		penX += 8.5 * unit
	}
	await sleep(500)
	await page.screenshot({ path: path.join(OUT, 'handwriting.png') })

	const t0 = Date.now()
	const look = await mcp.callTool({ name: 'look_at_canvas', arguments: {} })
	const text = look.content.find((x) => x.type === 'text' && x.text.startsWith('{')).text
	const data = JSON.parse(text)
	log(`look took ${((Date.now() - t0) / 1000).toFixed(1)}s`)
	log('newHandwriting:', JSON.stringify(data.newHandwriting))
	const images = look.content.filter((x) => x.type === 'image')
	if (images[1]) fs.writeFileSync(path.join(OUT, 'closeup-1.png'), Buffer.from(images[1].data, 'base64'))
	check(images.length >= 2, 'look_at_canvas includes a close-up of the new handwriting')
	check((data.newHandwriting ?? []).some((h) => /tray/i.test(h.where)), 'the handwriting is located in the Hand-to-Duet tray')
	check((data.newHandwriting ?? []).some((h) => /call\s*anna/i.test(h.text ?? '')), `the words are transcribed ("${data.newHandwriting?.[0]?.text}")`)

	const again = await mcp.callTool({ name: 'look_at_canvas', arguments: { includeScreenshot: false } })
	const data2 = JSON.parse(again.content.find((x) => x.type === 'text' && x.text.startsWith('{')).text)
	check(!data2.newHandwriting, 'the same handwriting is not reported as new twice')
	await mcp.close()
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
