import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { buildEnv } from '../claude/ClaudeSession'
import { sessions } from '../claude/SessionManager'
import { config, DATA_DIR } from '../env'

/**
 * Handwriting → text, on the Mac, with Claude through the person's Claude Code
 * login. Used by look_at_canvas so Duet gets the words, not only a picture.
 * One short, tool-less call per look (all new patches at once); results are
 * cached by image, so the same ink is never transcribed twice.
 */

export interface Transcription {
	id: string
	text: string
	confidence: 'high' | 'medium' | 'low'
}

const cache = new Map<string, Transcription>()
const CWD = path.join(DATA_DIR, 'claude-cwd')
fs.mkdirSync(CWD, { recursive: true })

const SYSTEM = `You transcribe handwriting written with an Apple Pencil on an iPad.
For each image, write exactly what the person wrote, keeping their line breaks. Don't correct, complete or interpret it.
If a mark is a drawing, tick, circle, arrow or scribble rather than words, describe it in brackets, e.g. "[tick]", "[circle]", "[arrow pointing right]", "[sketch of a house]".
Reply with JSON only: {"items":[{"id":"…","text":"…","confidence":"high|medium|low"}]}`

export async function transcribeHandwriting(crops: { id: string; where: string; image: string }[]): Promise<Transcription[]> {
	if (!config.transcribeHandwriting || crops.length === 0) return []
	const keyed = crops.map((c) => ({ ...c, key: crypto.createHash('sha256').update(c.image).digest('hex') }))
	const todo = keyed.filter((c) => !cache.has(c.key))

	if (todo.length) {
		const content: any[] = []
		for (const c of todo) {
			const m = /^data:(image\/\w+);base64,(.+)$/s.exec(c.image)
			if (!m) continue
			content.push({ type: 'text', text: `Image id "${c.id}" (written ${c.where}):` })
			content.push({ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } })
		}
		content.push({ type: 'text', text: 'Transcribe each image. JSON only.' })

		async function* prompt(): AsyncGenerator<SDKUserMessage> {
			yield { type: 'user', parent_tool_use_id: null, message: { role: 'user', content } }
		}

		let text = ''
		try {
			for await (const msg of query({
				prompt: prompt(),
				options: {
					model: config.transcribeModel,
					systemPrompt: SYSTEM,
					tools: [],
					settingSources: [],
					strictMcpConfig: true,
					mcpServers: {},
					cwd: CWD,
					maxTurns: 1,
					persistSession: false,
					env: buildEnv(sessions.authMode),
				},
			})) {
				if (msg.type === 'assistant') {
					for (const b of msg.message.content) if (b.type === 'text') text += b.text
				}
			}
			const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as { items: Transcription[] }
			for (const item of json.items ?? []) {
				const c = todo.find((t) => t.id === item.id)
				if (c) cache.set(c.key, { id: c.id, text: String(item.text ?? ''), confidence: item.confidence ?? 'medium' })
			}
		} catch (e) {
			console.warn('[handwriting] transcription failed:', (e as Error).message, text.slice(0, 200))
		}
	}

	return keyed.flatMap((c) => {
		const t = cache.get(c.key)
		return t ? [{ ...t, id: c.id }] : []
	})
}
