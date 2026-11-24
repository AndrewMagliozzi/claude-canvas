// Checks that private files are never served and that the API requires the
// passcode token. Starts its own server.   node scripts/security-check.mjs
import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

const PORT = 5191
const root = path.resolve('.')
const ip = process.env.HOST === '127.0.0.1' ? '127.0.0.1' : Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address ?? 'localhost'
const server = spawn(path.resolve('node_modules/.bin/tsx'), ['server/index.ts'], { env: { ...process.env, PORT: String(PORT), PASSCODE: '777777' }, stdio: 'ignore', detached: true })
const stop = () => { try { process.kill(-server.pid, 'SIGTERM') } catch {} }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let ok = true
const check = (c, label) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${label}`); ok &&= !!c }
try {
	for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${PORT}/api/config`)).ok) break } catch {} await sleep(500) }
	const base = `http://${ip}:${PORT}`
	const probes = [
		'/.data/auth.json', '/.data/auth.json?import', '/.data/auth.json?raw', '/%2Edata/auth.json?raw',
		`/@fs${root}/.data/auth.json?import`, `/@fs${root}/.data/sessions.json?raw`, `/@fs${root}/certs/rootCA-key.pem?raw`,
		'/certs/server-key.pem', '/.env?raw', '/server/env.ts', '/client/../.data/auth.json?raw',
	]
	for (const p of probes) {
		const body = await (await fetch(base + p)).text()
		check(!/"secret"|passcode|BEGIN .*PRIVATE KEY|ANTHROPIC_API_KEY/.test(body), `not leaked: ${p}`)
	}
	check((await fetch(base + '/client/main.tsx')).ok, 'app source still served')
	const ca = await fetch(base + '/ca.crt')
	check(ca.status === 200 || (await ca.text()).includes('npm run certs'), 'CA download route is not blocked')
	check((await fetch(base + '/stream', { method: 'POST', body: '{}' })).status === 401, '/stream requires the token')
	check((await fetch(base + '/api/reset', { method: 'POST', body: '{}' })).status === 401, '/api/reset requires the token')
	check((await fetch(base + '/api/bridge')).status === 401, '/api/bridge (canvas command channel) requires the token')
	check((await fetch(base + '/api/bridge/result', { method: 'POST', body: '{}' })).status === 401, '/api/bridge/result requires the token')
	check((await fetch(base + '/mcp/not-the-token', { method: 'POST', body: '{}' })).status === 404, 'the connector needs its secret token')
	const auth = await fetch(base + '/api/auth', { method: 'POST', body: JSON.stringify({ passcode: '777777' }) }).then((r) => r.json())
	check(auth.ok && auth.token, 'correct passcode yields a token')
	const cfg = await fetch(base + '/api/config', { headers: { Authorization: `Bearer ${auth.token}` } }).then((r) => r.json())
	check(cfg.authorized === true, 'token is accepted')
	let locked = false
	for (let i = 0; i < 6; i++) {
		const r = await fetch(base + '/api/auth', { method: 'POST', body: JSON.stringify({ passcode: '000000' }) }).then((r) => r.json())
		if (/Too many/.test(r.error ?? '')) locked = true
	}
	check(locked, 'repeated wrong passcodes trigger the lockout')
} catch (e) { console.error(e); ok = false } finally { stop(); console.log(ok ? 'ALL PASSED' : 'FAILED'); process.exit(ok ? 0 : 1) }
