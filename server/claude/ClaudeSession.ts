import fs from 'node:fs'
import path from 'node:path'
import {
	query,
	type CanUseTool,
	type Options,
	type Query,
	type SDKMessage,
	type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk'
import { config, DATA_DIR } from '../env'
import type { ContentBlock } from '../prompt/buildMessages'

/**
 * One long-lived Claude Code session per canvas conversation.
 *
 * We use the Agent SDK's streaming-input mode: a single `query()` whose prompt
 * is an async queue we push user turns into. That keeps the CLI process (and
 * prompt cache) warm between turns and gives Claude real conversation memory.
 * If the process dies or the server restarts, the next turn reopens the
 * session with `resume: sessionId`.
 */

export type TurnEvent =
	| { type: 'text'; text: string }
	| { type: 'message_start' }
	| { type: 'status'; status: string }
	| { type: 'result'; ok: boolean; error?: string; costUsd?: number; durationMs?: number }

export type AuthMode = 'login' | 'api-key'

export interface ClaudeSessionOptions {
	systemPrompt: string
	model: string
	resume?: string
	authMode: AuthMode
}

/** A minimal async queue usable as an AsyncIterable prompt. */
class AsyncQueue<T> implements AsyncIterable<T> {
	private items: T[] = []
	private waiters: ((r: IteratorResult<T>) => void)[] = []
	private closed = false

	push(item: T) {
		const w = this.waiters.shift()
		if (w) w({ value: item, done: false })
		else this.items.push(item)
	}

	close() {
		this.closed = true
		for (const w of this.waiters) w({ value: undefined as any, done: true })
		this.waiters = []
	}

	[Symbol.asyncIterator](): AsyncIterator<T> {
		return {
			next: () => {
				const item = this.items.shift()
				if (item !== undefined) return Promise.resolve({ value: item, done: false })
				if (this.closed) return Promise.resolve({ value: undefined as any, done: true })
				return new Promise((resolve) => this.waiters.push(resolve))
			},
		}
	}
}

const EMPTY_CWD = path.join(DATA_DIR, 'claude-cwd')
fs.mkdirSync(EMPTY_CWD, { recursive: true })

/** Read-only file tools, confined to WORKSPACE_DIR by realpath. */
const READ_ONLY_TOOLS = ['Read', 'Glob', 'Grep']

function isInsideWorkspace(p: unknown): boolean {
	if (!config.workspaceDir) return false
	if (typeof p !== 'string' || p === '') return true // tool default = cwd = workspace
	const abs = path.resolve(config.workspaceDir, p)
	let real: string
	try {
		real = fs.realpathSync(abs)
	} catch {
		// Non-existent path: check the lexical path instead.
		real = abs
	}
	return real === config.workspaceDir || real.startsWith(config.workspaceDir + path.sep)
}

const canUseTool: CanUseTool = async (toolName, input) => {
	if (!config.workspaceDir || !READ_ONLY_TOOLS.includes(toolName)) {
		return { behavior: 'deny', message: 'Only read-only file tools inside WORKSPACE_DIR are allowed.' }
	}
	const candidates = [input.file_path, input.path, input.notebook_path].filter((v) => v !== undefined)
	// Glob patterns (Glob's `pattern`, Grep's `glob`) must stay relative and inside the folder.
	const patterns = [toolName === 'Glob' ? input.pattern : undefined, input.glob].filter((v) => v !== undefined)
	// Reject anything that could expand outside the folder: absolute or home paths,
	// any "..", and brace/extglob alternation (e.g. "{..,x}" or "{/Users,x}").
	const badPattern = patterns.some(
		(p) => typeof p !== 'string' || /^[\/~]/.test(p) || p.includes('..') || /[{}]|[@!+*?]\(/.test(p)
	)
	if (badPattern) {
		return { behavior: 'deny', message: 'Glob patterns must be relative to WORKSPACE_DIR and may not contain "..".' }
	}
	if (toolName === 'Read' && candidates.length === 0) {
		return { behavior: 'deny', message: 'Read needs a file_path inside WORKSPACE_DIR.' }
	}
	if (candidates.every(isInsideWorkspace)) {
		return { behavior: 'allow', updatedInput: input }
	}
	return { behavior: 'deny', message: `Path is outside WORKSPACE_DIR (${config.workspaceDir}).` }
}

export function buildEnv(authMode: AuthMode): Record<string, string | undefined> {
	const env: Record<string, string | undefined> = {
		...process.env,
		CLAUDE_AGENT_SDK_CLIENT_APP: 'claude-canvas/0.1',
	}
	// If this server was itself started from inside a Claude Code session, don't
	// let the child think it's nested in that session.
	for (const key of Object.keys(env)) {
		if (/^(CLAUDECODE|CLAUDE_CODE_(ENTRYPOINT|SESSION_.*|CHILD_.*|MESSAGING_.*|EXECPATH)|CLAUDE_PID|CLAUDE_EFFORT)$/.test(key)) {
			delete env[key]
		}
	}
	// Claude Code prefers ANTHROPIC_API_KEY over the login when both exist,
	// so only pass it through when we deliberately fall back to it.
	if (authMode === 'login') delete env.ANTHROPIC_API_KEY
	else env.ANTHROPIC_API_KEY = config.apiKey ?? undefined
	return env
}

export class ClaudeSession {
	readonly systemPrompt: string
	readonly authMode: AuthMode
	private model: string
	private input = new AsyncQueue<SDKUserMessage>()
	private q: Query
	private iterator: AsyncIterator<SDKMessage>
	private turnLock: Promise<void> = Promise.resolve()
	private dead = false
	private deadReason: string | null = null
	sessionId: string | null = null
	/** True once the session has completed at least one turn (so it remembers history). */
	hasMemory: boolean
	/** True once a turn has succeeded in this process (so a resume, if any, worked). */
	confirmed = false
	/** What the Claude Code child reported as its credential source (e.g. 'none' = login). */
	lastApiKeySource: string | null = null

	constructor(opts: ClaudeSessionOptions) {
		this.systemPrompt = opts.systemPrompt
		this.model = opts.model
		this.authMode = opts.authMode
		this.sessionId = opts.resume ?? null
		this.hasMemory = !!opts.resume

		const workspace = config.workspaceDir
		const options: Options = {
			model: opts.model,
			systemPrompt: opts.systemPrompt,
			// Canvas actions only: no built-in tools unless WORKSPACE_DIR is set.
			tools: workspace ? READ_ONLY_TOOLS : [],
			allowedTools: [],
			disallowedTools: workspace ? [] : ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Agent'],
			canUseTool,
			permissionMode: 'default',
			// Isolation from the user's Claude Code config (hooks, CLAUDE.md, MCP servers).
			settingSources: [],
			strictMcpConfig: true,
			mcpServers: {},
			cwd: workspace ?? EMPTY_CWD,
			includePartialMessages: true,
			thinking: { type: 'adaptive' },
			effort: config.effort,
			env: buildEnv(opts.authMode),
			...(opts.resume ? { resume: opts.resume } : {}),
			stderr: (data: string) => {
				if (config.debug) process.stderr.write(`[claude] ${data}`)
			},
		}

		this.q = query({ prompt: this.input, options })
		this.iterator = this.q[Symbol.asyncIterator]()
	}

	/** Resolves when any in-flight turn (e.g. one being interrupted) has finished. */
	async waitForIdle() {
		await this.turnLock.catch(() => {})
	}

	isDead() {
		return this.dead
	}

	getDeadReason() {
		return this.deadReason
	}

	/**
	 * Run one turn. Turns are serialized: a new turn waits for the previous one's
	 * `result` before its message is pushed, so outputs never interleave.
	 */
	async *turn(content: ContentBlock[], opts: { model?: string; signal: AbortSignal }): AsyncGenerator<TurnEvent> {
		let release!: () => void
		const previous = this.turnLock
		this.turnLock = new Promise<void>((r) => (release = r))
		try {
			await previous
			if (this.dead) throw new Error(this.deadReason ?? 'Claude session ended')
			if (opts.signal.aborted) return

			if (opts.model && opts.model !== this.model) {
				await this.q.setModel(opts.model)
				this.model = opts.model
			}

			let interrupted = false
			const onAbort = () => {
				if (interrupted) return
				interrupted = true
				this.q.interrupt().catch(() => {})
			}
			opts.signal.addEventListener('abort', onAbort)

			this.input.push({
				type: 'user',
				parent_tool_use_id: null,
				message: { role: 'user', content: content as any },
			})

			try {
				while (true) {
					const { value: msg, done } = await this.iterator.next()
					if (done) {
						this.markDead('Claude session closed unexpectedly')
						yield { type: 'result', ok: false, error: this.deadReason! }
						return
					}
					const events = this.translate(msg)
					for (const ev of events) {
						// After an interrupt keep draining to the result, but stop forwarding output.
						if (interrupted && ev.type !== 'result') continue
						yield ev
						if (ev.type === 'result') {
							// Even an interrupted turn is in the transcript, so the session remembers it.
							this.hasMemory = true
							if (ev.ok) this.confirmed = true
							return
						}
					}
				}
			} finally {
				opts.signal.removeEventListener('abort', onAbort)
			}
		} catch (e: any) {
			this.markDead(e?.message ?? String(e))
			throw e
		} finally {
			release()
		}
	}

	private translate(msg: SDKMessage): TurnEvent[] {
		switch (msg.type) {
			case 'system': {
				if ((msg as any).subtype === 'init') {
					this.sessionId = msg.session_id
					this.lastApiKeySource = (msg as any).apiKeySource
					if (config.debug) console.log(`[claude] session ${msg.session_id} model=${(msg as any).model} auth=${(msg as any).apiKeySource}`)
				}
				return []
			}
			case 'stream_event': {
				const ev: any = (msg as any).event
				if (ev.type === 'message_start') return [{ type: 'message_start' }]
				if (ev.type === 'content_block_start') {
					const t = ev.content_block?.type
					if (t === 'thinking' || t === 'redacted_thinking') return [{ type: 'status', status: 'Thinking…' }]
					if (t === 'tool_use') return [{ type: 'status', status: `Using ${ev.content_block.name}…` }]
					if (t === 'text') return [{ type: 'status', status: 'Writing…' }]
				}
				if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
					return [{ type: 'text', text: ev.delta.text }]
				}
				return []
			}
			case 'result': {
				this.sessionId = msg.session_id
				const r: any = msg
				const ok = r.subtype === 'success' && !r.is_error
				return [
					{
						type: 'result',
						ok,
						error: ok ? undefined : (r.result || r.errors?.join('; ') || r.subtype),
						costUsd: r.total_cost_usd,
						durationMs: r.duration_ms,
					},
				]
			}
			default:
				return []
		}
	}

	private markDead(reason: string) {
		if (this.dead) return
		this.dead = true
		this.deadReason = reason
		this.close()
	}

	close() {
		this.dead = true
		this.input.close()
		try {
			this.q.close()
		} catch {
			// already closed
		}
	}
}
