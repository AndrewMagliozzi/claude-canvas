import { config, CERTS_DIR, ROOT_DIR } from './env'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { connectorToken, isAuthorized, isConnectorToken, isValidToken, passcode, tryPasscode } from './auth'
import { addBridgeClient, bridgeStatus, markActive, resolveCommand } from './duet/bridge'
import { handleMcp } from './duet/mcp'
import { sessions } from './claude/SessionManager'
import { handleStream } from './stream'

const MAX_BODY = 40 * 1024 * 1024

function readJson(req: IncomingMessage): Promise<any> {
	return new Promise((resolve, reject) => {
		let size = 0
		const chunks: Buffer[] = []
		req.on('data', (c: Buffer) => {
			size += c.length
			if (size > MAX_BODY) {
				reject(new Error('Request too large'))
				req.destroy()
				return
			}
			chunks.push(c)
		})
		req.on('end', () => {
			try {
				resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {})
			} catch (e) {
				reject(e)
			}
		})
		req.on('error', reject)
	})
}

function json(res: ServerResponse, status: number, data: unknown) {
	res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
	res.end(JSON.stringify(data))
}

const caPath = path.join(CERTS_DIR, 'rootCA.pem')

/**
 * Paths that must never be served (Vite would happily serve any file under the
 * project root, including .data/auth.json with the passcode and token secret).
 */
const ROOT_POSIX = ROOT_DIR.split(path.sep).join('/')
const escapeRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// Anchored to the project root, both as a plain URL path and as Vite's /@fs/<abs path>.
const PRIVATE_PATH = new RegExp(
	`^(/@fs${escapeRe(ROOT_POSIX)})?/(\\.data|certs|\\.env[^/]*|\\.git|server)(/|$)|\\.(pem|key)$`,
	'i'
)
const PUBLIC_EXCEPTIONS = new Set(['/ca.crt', '/ca.pem'])

export function isPrivatePath(rawUrl: string | undefined): boolean {
	let pathname = (rawUrl ?? '/').split('?')[0]
	for (let i = 0; i < 3; i++) {
		try {
			const decoded = decodeURIComponent(pathname)
			if (decoded === pathname) break
			pathname = decoded
		} catch {
			return true
		}
	}
	pathname = path.posix.normalize(pathname.replace(/\\/g, '/'))
	if (PUBLIC_EXCEPTIONS.has(pathname)) return false
	return PRIVATE_PATH.test(pathname)
}

/** Handles our API routes. Returns false if the request should fall through to the app. */
async function handleApi(req: IncomingMessage, res: ServerResponse, isHttps: boolean): Promise<boolean> {
	const url = new URL(req.url ?? '/', 'http://local')
	const route = `${req.method} ${url.pathname}`

	// Claude connector (Duet, Claude chat, Claude Code): /mcp/<connector token>
	const mcpMatch = /^\/mcp\/([^/]+)\/?$/.exec(url.pathname)
	if (mcpMatch) {
		const started = Date.now()
		res.on('finish', () => {
			const who = (req.headers['user-agent'] ?? '').slice(0, 40)
			console.log(`[connector] ${req.method} → ${res.statusCode} in ${Date.now() - started}ms (${who})`)
		})
		if (!isConnectorToken(mcpMatch[1])) {
			res.writeHead(404, { 'Content-Type': 'text/plain' })
			res.end('Not found')
			return true
		}
		const body = req.method === 'POST' ? await readJson(req).catch(() => undefined) : undefined
		await handleMcp(req, res, body)
		return true
	}

	switch (route) {
		case 'GET /api/config': {
			json(res, 200, {
				authorized: isAuthorized(req),
				enableScriptAction: config.enableScriptAction,
				workspaceEnabled: !!config.workspaceDir,
				defaultModel: config.defaultModel,
				https: isHttps,
				caAvailable: fs.existsSync(caPath),
			})
			return true
		}
		case 'POST /api/auth': {
			const body = await readJson(req).catch(() => ({}))
			const result = tryPasscode(body.passcode, req.socket.remoteAddress ?? 'unknown')
			json(res, result.ok ? 200 : 401, result)
			return true
		}
		case 'POST /api/reset': {
			if (!isAuthorized(req)) return json(res, 401, { error: 'Unauthorized' }), true
			const body = await readJson(req).catch(() => ({}))
			if (typeof body.conversationId === 'string') sessions.reset(body.conversationId)
			json(res, 200, { ok: true })
			return true
		}
		case 'POST /stream': {
			if (!isAuthorized(req)) return json(res, 401, { error: 'Unauthorized: enter the passcode shown in the terminal.' }), true
			let body
			try {
				body = await readJson(req)
			} catch (e: any) {
				json(res, 400, { error: e?.message ?? 'Bad request' })
				return true
			}
			await handleStream(req, res, body)
			return true
		}
		case 'GET /api/bridge': {
			// The canvas's command channel (EventSource can't send headers, so the token is in the query).
			if (!isValidToken(url.searchParams.get('token'))) return json(res, 401, { error: 'Unauthorized' }), true
			addBridgeClient(res, req.socket.remoteAddress ?? 'unknown')
			return true
		}
		case 'POST /api/bridge/result': {
			if (!isAuthorized(req)) return json(res, 401, { error: 'Unauthorized' }), true
			const body = await readJson(req).catch(() => ({}))
			if (typeof body.id === 'string') resolveCommand(body.id, !!body.ok, body.result)
			json(res, 200, { ok: true })
			return true
		}
		case 'POST /api/bridge/active': {
			if (!isAuthorized(req)) return json(res, 401, { error: 'Unauthorized' }), true
			const body = await readJson(req).catch(() => ({}))
			if (typeof body.clientId === 'string') markActive(body.clientId)
			json(res, 200, { ok: true, ...bridgeStatus() })
			return true
		}
		case 'GET /ca.crt':
		case 'GET /ca.pem': {
			if (!fs.existsSync(caPath)) {
				res.writeHead(404, { 'Content-Type': 'text/plain' })
				res.end('No local CA yet. Run `npm run certs` on the Mac first.')
				return true
			}
			res.writeHead(200, {
				'Content-Type': 'application/x-x509-ca-cert',
				'Content-Disposition': 'attachment; filename="claude-canvas-local-ca.crt"',
			})
			fs.createReadStream(caPath).pipe(res)
			return true
		}
	}
	return false
}

function lanAddresses(): string[] {
	const out: { name: string; address: string }[] = []
	for (const [name, infos] of Object.entries(os.networkInterfaces())) {
		for (const info of infos ?? []) {
			if (info.family === 'IPv4' && !info.internal) out.push({ name, address: info.address })
		}
	}
	// Prefer Wi-Fi/Ethernet (en*) over VPN/bridge interfaces.
	out.sort((a, b) => Number(b.name.startsWith('en')) - Number(a.name.startsWith('en')))
	return out.map((o) => o.address)
}

async function createAppHandler(hmrServer: http.Server | https.Server) {
	if (config.isProduction) {
		const dist = path.join(ROOT_DIR, 'dist')
		if (!fs.existsSync(dist)) throw new Error('No dist/ folder. Run `npm run build` first.')
		const types: Record<string, string> = {
			'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
			'.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2',
		}
		return (req: IncomingMessage, res: ServerResponse) => {
			const url = new URL(req.url ?? '/', 'http://local')
			let file = path.normalize(path.join(dist, decodeURIComponent(url.pathname)))
			if (!file.startsWith(dist + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
				file = path.join(dist, 'index.html')
			}
			res.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream' })
			fs.createReadStream(file).pipe(res)
		}
	}
	const { createServer } = await import('vite')
	const vite = await createServer({
		root: ROOT_DIR,
		configFile: path.join(ROOT_DIR, 'vite.config.ts'),
		server: {
			middlewareMode: true,
			hmr: { server: hmrServer },
			// LAN IPs are always allowed; also allow Tailscale (*.ts.net) and Bonjour (*.local) names.
			allowedHosts: ['localhost', '.ts.net', '.local'],
			fs: {
				deny: [
					'.env',
					'.env.*',
					'*.{crt,pem,key}',
					...['.data', 'certs', 'server', '.git'].map((d) => path.join(ROOT_DIR, d) + '/**'),
				],
			},
		},
		appType: 'spa',
	})
	return vite.middlewares
}

async function main() {
	let certs: { key: Buffer; cert: Buffer } | null = null
	if (config.https) {
		const keyPath = path.join(CERTS_DIR, 'server-key.pem')
		const certPath = path.join(CERTS_DIR, 'server-cert.pem')
		if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
			console.error('\nHTTPS certificates not found. Run `npm run certs` first (see README → Voice / HTTPS).\n')
			process.exit(1)
		}
		certs = { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }
	}

	// The main server: HTTPS when --https, otherwise plain HTTP.
	let appHandler: ((req: IncomingMessage, res: ServerResponse, next?: () => void) => void) | null = null
	const handler = async (isHttps: boolean, req: IncomingMessage, res: ServerResponse) => {
		if (isPrivatePath(req.url)) {
			res.writeHead(404, { 'Content-Type': 'text/plain' })
			res.end('Not found')
			return
		}
		try {
			if (await handleApi(req, res, isHttps)) return
		} catch (e: any) {
			console.error(e)
			if (!res.headersSent) json(res, 500, { error: e?.message ?? 'Server error' })
			return
		}
		appHandler!(req, res, () => {
			res.writeHead(404)
			res.end('Not found')
		})
	}

	const main = certs
		? https.createServer(certs, (req, res) => handler(true, req, res))
		: http.createServer((req, res) => handler(false, req, res))
	appHandler = await createAppHandler(main)

	const mainPort = certs ? config.httpsPort : config.port
	await new Promise<void>((resolve) => main.listen(mainPort, config.host, resolve))

	// In HTTPS mode, the plain HTTP port only serves the CA certificate (for the
	// iPad to download) and redirects everything else to HTTPS.
	if (certs) {
		const redirect = http.createServer(async (req, res) => {
			const pathname = new URL(req.url ?? '/', 'http://local').pathname
			if (req.method === 'GET' && (pathname === '/ca.crt' || pathname === '/ca.pem')) {
				await handleApi(req, res, false).catch(() => false)
				return
			}
			const host = (req.headers.host ?? 'localhost').replace(/:\d+$/, '')
			res.writeHead(302, { Location: `https://${host}:${config.httpsPort}${req.url ?? '/'}` })
			res.end()
		})
		redirect.listen(config.port, config.host)
	}

	const scheme = certs ? 'https' : 'http'
	const ips = lanAddresses()
	const line = (label: string, value: string) => console.log(`  ${label.padEnd(16)}${value}`)
	console.log('\n  \x1b[1mClaude Canvas\x1b[0m is running\n')
	line('On this Mac:', `${scheme}://localhost:${mainPort}`)
	if (ips.length === 0) line('On your iPad:', '(no LAN address found — are you on Wi-Fi?)')
	ips.forEach((ip, i) => line(i === 0 ? 'On your iPad:' : '', `\x1b[1m${scheme}://${ip}:${mainPort}\x1b[0m`))
	line('Passcode:', `\x1b[1m${passcode}\x1b[0m`)
	line('Claude auth:', `Claude Code login${config.apiKey ? ' (ANTHROPIC_API_KEY set as fallback)' : ''}`)
	line('Model:', `${config.defaultModel} (effort: ${config.effort})`)
	line('File tools:', config.workspaceDir ? `read-only in ${config.workspaceDir}` : 'off')
	line('Script action:', config.enableScriptAction ? 'ON (ENABLE_SCRIPT_ACTION=1)' : 'off')
	line('Claude connector:', `/mcp/${connectorToken.slice(0, 6)}…  (full URL: npm run connector-url)`)
	if (certs) line('CA certificate:', `http://${ips[0] ?? 'localhost'}:${config.port}/ca.crt`)
	else line('Voice input:', 'needs HTTPS — see README (`npm run certs`, then `npm run dev:https`)')
	console.log('')

	const shutdown = () => {
		sessions.closeAll()
		process.exit(0)
	}
	process.on('SIGINT', shutdown)
	process.on('SIGTERM', shutdown)
}

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
