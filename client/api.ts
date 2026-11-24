import { atom } from 'tldraw'

/**
 * Small client for the local server: passcode auth, server config, reset.
 */

const TOKEN_KEY = 'claude-canvas:token'

export interface ServerConfig {
	authorized: boolean
	enableScriptAction: boolean
	workspaceEnabled: boolean
	defaultModel: string
	https: boolean
	caAvailable: boolean
}

export const $serverConfig = atom<ServerConfig | null>('serverConfig', null)

function safeGet(key: string): string | null {
	try {
		return localStorage.getItem(key)
	} catch {
		return null
	}
}

function safeSet(key: string, value: string | null) {
	try {
		if (value === null) localStorage.removeItem(key)
		else localStorage.setItem(key, value)
	} catch {
		// storage unavailable (private mode); token lives in memory only
	}
}

let memoryToken: string | null = safeGet(TOKEN_KEY)

export function getToken() {
	return memoryToken
}

export function authHeaders(): Record<string, string> {
	return memoryToken ? { Authorization: `Bearer ${memoryToken}` } : {}
}

export async function fetchServerConfig(): Promise<ServerConfig> {
	const res = await fetch('/api/config', { headers: authHeaders(), cache: 'no-store' })
	const cfg = (await res.json()) as ServerConfig
	$serverConfig.set(cfg)
	return cfg
}

export async function submitPasscode(passcode: string): Promise<{ ok: boolean; error?: string }> {
	const res = await fetch('/api/auth', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ passcode }),
	})
	const data = await res.json().catch(() => ({ ok: false, error: 'Server error' }))
	if (data.ok && data.token) {
		memoryToken = data.token
		safeSet(TOKEN_KEY, data.token)
		await fetchServerConfig()
		return { ok: true }
	}
	return { ok: false, error: data.error ?? 'Wrong passcode' }
}

/** Called when the server rejects our token (e.g. passcode rotated). */
export function clearToken() {
	memoryToken = null
	safeSet(TOKEN_KEY, null)
	const cfg = $serverConfig.get()
	if (cfg) $serverConfig.set({ ...cfg, authorized: false })
}

export async function resetConversation(conversationId: string) {
	try {
		await fetch('/api/reset', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', ...authHeaders() },
			body: JSON.stringify({ conversationId }),
		})
	} catch {
		// best effort
	}
}

export function newConversationId() {
	const c = globalThis.crypto
	if (c && 'randomUUID' in c) return c.randomUUID()
	return 'c-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)
}
