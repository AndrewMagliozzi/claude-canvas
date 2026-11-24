import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { IncomingMessage } from 'node:http'
import { config, DATA_DIR } from './env'

/**
 * Passcode auth.
 *
 * A 6-digit passcode is generated once and stored in .data/auth.json so the
 * iPad doesn't need to re-enter it after every restart. It is printed in the
 * terminal at startup. `npm run dev -- --new-passcode` rotates it (and revokes
 * every existing token). PASSCODE=... in the environment overrides it.
 *
 * After entering the passcode the browser receives a bearer token, an HMAC of
 * the passcode with a server secret, so rotating either revokes all tokens.
 */

interface AuthFile {
	passcode: string
	secret: string
	/** Secret path segment for the Claude Duet connector URL (/mcp/<token>). */
	connectorToken?: string
}

const AUTH_FILE = path.join(DATA_DIR, 'auth.json')

function loadOrCreate(): AuthFile {
	if (!config.rotatePasscode && fs.existsSync(AUTH_FILE)) {
		try {
			const parsed = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8')) as AuthFile
			if (parsed.passcode && parsed.secret) return parsed
		} catch {
			// fall through and regenerate
		}
	}
	// Rotating the passcode keeps the Duet connector URL working.
	let connectorToken: string | undefined
	try {
		connectorToken = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8')).connectorToken
	} catch {
		// no previous file
	}
	const file: AuthFile = {
		passcode: String(crypto.randomInt(0, 1_000_000)).padStart(6, '0'),
		secret: crypto.randomBytes(32).toString('hex'),
		connectorToken,
	}
	fs.writeFileSync(AUTH_FILE, JSON.stringify(file, null, 2), { mode: 0o600 })
	return file
}

const auth = loadOrCreate()

// The connector token is separate from the passcode, so rotating one doesn't break the other.
if (!auth.connectorToken || process.argv.includes('--new-connector-token')) {
	auth.connectorToken = crypto.randomBytes(24).toString('base64url')
	fs.writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2), { mode: 0o600 })
}

export const connectorToken = process.env.CONNECTOR_TOKEN?.trim() || auth.connectorToken

/** Constant-time check of the token in a /mcp/<token> path. */
export function isConnectorToken(candidate: string) {
	return safeEqual(candidate, connectorToken)
}

/** Token check for EventSource connections (which can't send headers). */
export function isValidToken(candidate: string | null) {
	return !!candidate && safeEqual(candidate, token)
}

export const passcode = config.passcodeOverride ?? auth.passcode

const token = crypto.createHmac('sha256', auth.secret).update(passcode).digest('hex')

function safeEqual(a: string, b: string) {
	const ab = Buffer.from(a)
	const bb = Buffer.from(b)
	return ab.length === bb.length && crypto.timingSafeEqual(ab, bb)
}

// Simple brute-force protection: after 5 failures from an address, wait 30s.
const failures = new Map<string, { count: number; until: number }>()

export function tryPasscode(
	attempt: unknown,
	remote: string
): { ok: true; token: string } | { ok: false; error: string } {
	const now = Date.now()
	const f = failures.get(remote)
	if (f && f.until > now) {
		return { ok: false, error: 'Too many attempts. Wait 30 seconds and try again.' }
	}
	if (typeof attempt === 'string' && safeEqual(attempt.trim(), passcode)) {
		failures.delete(remote)
		return { ok: true, token }
	}
	const count = (f?.count ?? 0) + 1
	failures.set(remote, { count, until: count >= 5 ? now + 30_000 : 0 })
	return { ok: false, error: 'Wrong passcode.' }
}

export function isAuthorized(req: IncomingMessage): boolean {
	const header = req.headers.authorization ?? ''
	const match = /^Bearer\s+(.+)$/i.exec(header)
	if (!match) return false
	return safeEqual(match[1].trim(), token)
}
