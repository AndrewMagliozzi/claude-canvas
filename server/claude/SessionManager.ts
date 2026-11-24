import fs from 'node:fs'
import path from 'node:path'
import { config, DATA_DIR } from '../env'
import { AuthMode, ClaudeSession } from './ClaudeSession'

/**
 * Maps a canvas conversation id (generated in the browser, reset by "New chat")
 * to a live ClaudeSession, and persists conversation → Claude session id so a
 * server restart can resume the same Claude conversation.
 */

const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json')

function loadIds(): Record<string, string> {
	try {
		return JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'))
	} catch {
		return {}
	}
}

const AUTH_ERROR = /(auth|log ?in|credential|401|api key|apiKey|oauth|unauthori[sz]ed|not logged)/i

class SessionManager {
	private live = new Map<string, ClaudeSession>()
	private ids: Record<string, string> = loadIds()
	/** Login first; switch to the API key if the login fails and a key exists. */
	authMode: AuthMode = 'login'

	private saveIds() {
		fs.writeFileSync(SESSIONS_FILE, JSON.stringify(this.ids, null, 2))
	}

	/**
	 * Get a session for this conversation, creating or resuming one as needed.
	 * A session is recreated (resuming the same transcript) if the system prompt
	 * changed or the previous process died.
	 */
	get(conversationId: string, systemPrompt: string, model: string): ClaudeSession {
		const existing = this.live.get(conversationId)
		if (existing && !existing.isDead() && existing.systemPrompt === systemPrompt && existing.authMode === this.authMode) {
			return existing
		}
		const resume = existing?.sessionId ?? this.ids[conversationId]
		existing?.close()
		const session = new ClaudeSession({ systemPrompt, model, resume, authMode: this.authMode })
		this.live.set(conversationId, session)
		return session
	}

	/** Record the Claude session id for a conversation once it's known. */
	remember(conversationId: string, session: ClaudeSession) {
		if (session.sessionId && this.ids[conversationId] !== session.sessionId) {
			this.ids[conversationId] = session.sessionId
			this.saveIds()
		}
	}

	/** Drop a conversation (e.g. after "New chat" in the browser). */
	reset(conversationId: string) {
		this.live.get(conversationId)?.close()
		this.live.delete(conversationId)
		if (conversationId in this.ids) {
			delete this.ids[conversationId]
			this.saveIds()
		}
	}

	/** Forget a session id that could not be resumed. */
	forgetResume(conversationId: string) {
		this.live.get(conversationId)?.close()
		this.live.delete(conversationId)
		delete this.ids[conversationId]
		this.saveIds()
	}

	/** Returns true if we switched auth mode and the caller should retry. */
	maybeFallBackToApiKey(error: string): boolean {
		if (this.authMode === 'login' && config.apiKey && AUTH_ERROR.test(error)) {
			console.warn('Claude Code login failed; falling back to ANTHROPIC_API_KEY.')
			this.authMode = 'api-key'
			return true
		}
		return false
	}

	closeAll() {
		for (const s of this.live.values()) s.close()
		this.live.clear()
	}
}

export const sessions = new SessionManager()
