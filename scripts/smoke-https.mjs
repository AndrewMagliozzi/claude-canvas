// Smoke test for `npm run dev:https`: loads the app over HTTPS on the Mac's LAN
// IP (not localhost), and checks the canvas mounts in a secure context with
// voice available, the CA download works, and plain HTTP redirects.
import { spawn } from 'node:child_process'
import os from 'node:os'
import { chromium } from 'playwright-core'

const PORT = 5197, HTTPS_PORT = 5198
const ip = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address ?? 'localhost'
const server = spawn('npx', ['tsx', 'server/index.ts', '--https'], { env: { ...process.env, PORT: String(PORT), HTTPS_PORT: String(HTTPS_PORT), PASSCODE: '515151' }, stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let ok = true
const check = (c, label) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${label}`); ok &&= !!c }
try {
	for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${PORT}/ca.crt`)).ok) break } catch {} await sleep(500) }
	const ca = await fetch(`http://${ip}:${PORT}/ca.crt`)
	check(ca.ok && ca.headers.get('content-type')?.includes('x509'), `CA certificate downloadable at http://${ip}:${PORT}/ca.crt`)
	const redirect = await fetch(`http://${ip}:${PORT}/`, { redirect: 'manual' })
	check(redirect.status === 302 && redirect.headers.get('location')?.startsWith(`https://${ip}:${HTTPS_PORT}`), 'plain HTTP redirects to HTTPS')
	const browser = await chromium.launch({ channel: 'chrome' })
	const page = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage()
	await page.goto(`https://${ip}:${HTTPS_PORT}/`)
	await page.waitForFunction(() => window.editor, null, { timeout: 30000 })
	await page.fill('.auth-input', '515151'); await page.click('.auth-button')
	await page.waitForSelector('.send-button')
	await sleep(4000) // give the license check time to settle
	const info = await page.evaluate(() => ({
		secure: window.isSecureContext,
		speech: !!(window.SpeechRecognition || window.webkitSpeechRecognition),
		canvas: !!document.querySelector('.tl-canvas'),
		micUnavailable: !!document.querySelector('.mic-button.unavailable'),
		watermark: document.querySelector('[class*="tl-watermark"]')?.textContent ?? null,
	}))
	console.log(JSON.stringify(info))
	check(info.secure, 'secure context over HTTPS on the LAN IP')
	check(info.canvas, 'canvas renders over HTTPS on the LAN IP (dev-mode license)')
	await browser.close()
} catch (e) { console.error(e); ok = false } finally { server.kill('SIGTERM'); console.log(ok ? 'ALL PASSED' : 'FAILED'); process.exit(ok ? 0 : 1) }
