import type { IncomingMessage, ServerResponse } from 'node:http'
import { AgentPrompt } from '../shared/types/AgentPrompt'
import { resolveModelForRequest } from '../shared/models'
import { ActionStreamParser } from './claude/parseActions'
import { sessions } from './claude/SessionManager'
import { config } from './env'
import { buildUserContent } from './prompt/buildMessages'
import { buildSystemPrompt } from './prompt/buildSystemPrompt'

export interface StreamBody {
	conversationId: string
	prompt: AgentPrompt
}

/**
 * POST /stream — run one Claude turn and stream canvas actions back as SSE.
 *
 * Event payloads:
 *   - an action object (kit format: {_type, ..., complete, time})
 *   - {"__status": "Thinking…"} — progress for the status line
 *   - {"__done": {costUsd, durationMs}} — turn finished
 *   - {"error": "..."} — turn failed
 */
export async function handleStream(req: IncomingMessage, res: ServerResponse, body: StreamBody) {
	const { conversationId, prompt } = body
	if (typeof conversationId !== 'string' || !conversationId || !prompt || !prompt.mode) {
		res.writeHead(400, { 'Content-Type': 'application/json' })
		res.end(JSON.stringify({ error: 'Bad request' }))
		return
	}

	res.writeHead(200, {
		'Content-Type': 'text/event-stream',
		'Cache-Control': 'no-cache, no-transform',
		Connection: 'keep-alive',
		'X-Accel-Buffering': 'no',
	})
	res.flushHeaders?.()

	const send = (data: unknown) => {
		if (!res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`)
	}

	// Stop button / closed tab → interrupt the Claude turn (not the whole session).
	const controller = new AbortController()
	let finished = false
	res.on('close', () => {
		if (!finished) {
			console.log(`[turn] client closed the stream early (conversation ${conversationId.slice(0, 8)}); interrupting`)
			controller.abort()
		}
	})

	const systemPrompt = buildSystemPrompt(prompt)
	const requested = (prompt as any).modelName?.modelName as string | undefined
	const model = resolveModelForRequest(requested, config.defaultModel)

	if (config.debug) {
		console.log(`\n[turn] conversation=${conversationId} model=${model}`)
	}

	send({ __status: 'Sending to Claude…' })

	try {
		for (let attempt = 0; attempt < 3; attempt++) {
			const session = sessions.get(conversationId, systemPrompt, model)
			// Let an interrupted previous turn finish first, so we know what the session remembers.
			await session.waitForIdle()
			const wasResumed = session.hasMemory && !session.confirmed
			const content = buildUserContent(prompt, { skipChatHistory: session.hasMemory })
			if (config.debug) {
				const text = content.filter((b) => b.type === 'text').map((b: any) => b.text).join('\n')
				console.log(`[turn] user content (${content.length} blocks, ${text.length} chars text, memory=${session.hasMemory})`)
				console.log(text.slice(0, 4000))
			}

			const parser = new ActionStreamParser()
			let producedOutput = false
			let retry = false
			let failure: string | null = null

			try {
				for await (const ev of session.turn(content, { model, signal: controller.signal })) {
					if (ev.type === 'message_start') {
						parser.resetMessage()
					} else if (ev.type === 'status') {
						send({ __status: ev.status })
					} else if (ev.type === 'text') {
						producedOutput = true
						for (const action of parser.push(ev.text)) send(action)
					} else if (ev.type === 'result') {
						for (const action of parser.finish()) send(action)
						sessions.remember(conversationId, session)
						if (config.debug) console.log('[turn] raw output:\n' + parser.getRaw().slice(0, 6000))
						if (ev.ok) {
							send({ __done: { costUsd: ev.costUsd, durationMs: ev.durationMs } })
						} else if (controller.signal.aborted) {
							send({ __done: { cancelled: true } })
						} else {
							failure = ev.error ?? 'Claude turn failed'
						}
					}
				}
			} catch (e: any) {
				failure = e?.message ?? String(e)
			}

			if (!failure || controller.signal.aborted) break

			console.warn(`[turn] failed (attempt ${attempt + 1}): ${failure}`)
			if (!producedOutput && sessions.maybeFallBackToApiKey(failure)) retry = true
			else if (!producedOutput && wasResumed) {
				// The stored session couldn't be resumed; start fresh and replay history.
				sessions.forgetResume(conversationId)
				retry = true
			}
			if (!retry) {
				send({ error: friendlyError(failure) })
				break
			}
		}
	} finally {
		finished = true
		if (!res.writableEnded) res.end()
	}
}

function friendlyError(error: string) {
	if (/(log ?in|auth|credential|401|oauth)/i.test(error)) {
		return `Claude couldn't authenticate. Run \`claude\` on the Mac and log in (or set ANTHROPIC_API_KEY), then try again. Details: ${error}`
	}
	return error
}
