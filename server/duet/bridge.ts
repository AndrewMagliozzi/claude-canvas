import crypto from 'node:crypto'
import type { ServerResponse } from 'node:http'

/**
 * Server half of the canvas bridge. Each open canvas (iPad, Mac browser)
 * holds a server-sent-events connection; Duet's tool calls are forwarded to
 * the most recently active canvas, which POSTs the result back.
 */

interface Client {
	id: string
	res: ServerResponse
	lastActive: number
	remote: string
}

const clients = new Map<string, Client>()
const pending = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>()

export function addBridgeClient(res: ServerResponse, remote: string) {
	const id = crypto.randomUUID()
	res.writeHead(200, {
		'Content-Type': 'text/event-stream',
		'Cache-Control': 'no-cache, no-transform',
		Connection: 'keep-alive',
		'X-Accel-Buffering': 'no',
	})
	res.write(`data: ${JSON.stringify({ type: 'hello', clientId: id })}\n\n`)
	const client: Client = { id, res, lastActive: Date.now(), remote }
	clients.set(id, client)
	const keepAlive = setInterval(() => res.write(`: ping\n\n`), 20_000)
	res.on('close', () => {
		clearInterval(keepAlive)
		clients.delete(id)
	})
	return id
}

/** Mark this canvas connection as the one in use (the person just touched it). */
export function markActive(clientId: string) {
	const c = clients.get(clientId)
	if (c) c.lastActive = Date.now()
}

export function bridgeStatus() {
	return { connectedCanvases: clients.size }
}

function pickClient(): Client | null {
	let best: Client | null = null
	for (const c of clients.values()) if (!best || c.lastActive > best.lastActive) best = c
	return best
}

export class CanvasNotOpenError extends Error {}

/** Send a command to the open canvas and wait for its answer. */
export function sendToCanvas<T = any>(type: string, args: unknown, timeoutMs = 30_000): Promise<T> {
	const client = pickClient()
	if (!client) {
		return Promise.reject(
			new CanvasNotOpenError(
				"The person's canvas isn't open right now (no iPad or browser has the Claude Canvas page open). Ask them to open it, or try again later."
			)
		)
	}
	const id = crypto.randomUUID()
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => {
			pending.delete(id)
			reject(new Error('The canvas did not respond in time (the iPad may be asleep).'))
		}, timeoutMs)
		pending.set(id, { resolve, reject, timer })
		client.res.write(`data: ${JSON.stringify({ id, type, args })}\n\n`)
	})
}

export function resolveCommand(id: string, ok: boolean, result: any) {
	const p = pending.get(id)
	if (!p) return
	pending.delete(id)
	clearTimeout(p.timer)
	if (ok) p.resolve(result)
	else p.reject(new Error(result?.error ?? 'Canvas command failed'))
}
