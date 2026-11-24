import { AgentAction } from '../../shared/types/AgentAction'
import { getFocusedShapeSchemaNames } from '../../shared/format/FocusedShape'
import { Streaming } from '../../shared/types/Streaming'

const SHAPE_TYPES = new Set<string>(getFocusedShapeSchemaNames())

/**
 * Models occasionally emit a shape as if it were an action
 * ({"_type":"text","shapeId":…}) instead of {"_type":"create","shape":{…}}.
 * Rewrite those into proper create actions rather than dropping them.
 */
export function normalizeAction(action: any): any {
	if (!action || typeof action !== 'object') return action
	if (SHAPE_TYPES.has(action._type) && action._type !== 'unknown') {
		const { intent, ...shape } = action
		return { _type: 'create', intent: intent ?? `Create ${action._type}`, shape }
	}
	return action
}

/**
 * Repair a possibly incomplete or slightly malformed JSON string and parse it.
 *
 * - Closes open strings, arrays and objects (the text is still streaming).
 * - Drops stray closing brackets that don't match (models occasionally emit an
 *   extra `}`), instead of failing every action after it.
 * - Stops at the end of the first top-level value (ignores a trailing ``` fence).
 * - Tracks backslash escapes properly, so HTML/JS payloads parse.
 *
 * Returns null if it still can't be parsed.
 */
export function closeAndParseJson(input: string): any {
	return scanJson(input).value
}

/** Like closeAndParseJson, but also returns the index just past the top-level value (-1 if still open). */
export function scanJson(input: string): { value: any; end: number } {
	let end = -1
	const stack: string[] = []
	let out = ''
	let inString = false
	let escaped = false
	let started = false

	for (let i = 0; i < input.length; i++) {
		const c = input[i]
		if (inString) {
			out += c
			if (escaped) escaped = false
			else if (c === '\\') escaped = true
			else if (c === '"') inString = false
			continue
		}
		if (c === '"') {
			inString = true
			out += c
		} else if (c === '{' || c === '[') {
			stack.push(c)
			started = true
			out += c
		} else if (c === '}' || c === ']') {
			const want = c === '}' ? '{' : '['
			if (stack.at(-1) !== want) continue // stray closer: drop it
			stack.pop()
			out += c
			if (started && stack.length === 0) {
				end = i + 1
				break // end of the top-level value
			}
		} else {
			out += c
		}
	}

	let s = out
	if (inString) {
		// A dangling backslash would escape our closing quote.
		if (escaped) s = s.slice(0, -1)
		// A partial unicode escape (\u12) is invalid JSON; trim it.
		s = s.replace(/\\u[0-9a-fA-F]{0,3}$/, '')
		s += '"'
	}
	for (let i = stack.length - 1; i >= 0; i--) {
		s += stack[i] === '{' ? '}' : ']'
	}

	try {
		return { value: JSON.parse(s), end }
	} catch {
		// Trailing comma or a dangling key ("foo": ) — trim back and retry once.
		const trimmed = s.replace(/,\s*([}\]]+)$/, '$1').replace(/,?\s*"[^"]*"\s*:\s*([}\]]+)$/, '$1')
		try {
			return { value: JSON.parse(trimmed), end }
		} catch {
			return { value: null, end }
		}
	}
}

/**
 * Incrementally turns streamed model text into kit-style streaming actions.
 *
 * Expected output: {"actions": [ {...}, {...} ]}. We tolerate a preamble or a
 * ```json fence by starting at the first `{`.
 */
export class ActionStreamParser {
	private raw = ''
	/** Where the current JSON document starts in `raw` (search from here). */
	private docFrom = 0
	/** Index of the action currently streaming (not yet known to be complete). */
	private cursor = 0
	private last: AgentAction | null = null
	private startTime = Date.now()
	/** How many documents have been completed in this message. */
	private docCount = 0
	/** Shape ids created by completed earlier documents (a "redo" mustn't duplicate them). */
	private priorIds = new Set<string>()
	private currentIds = new Set<string>()

	/** Reset when a new assistant message begins (e.g. after a tool call). */
	resetMessage() {
		this.raw = ''
		this.docFrom = 0
		this.cursor = 0
		this.last = null
	}

	getRaw() {
		return this.raw
	}

	/**
	 * Emit an action, unless it's from a later document ("Actually… redo:") and
	 * would re-create a shape an earlier document already created.
	 */
	private emit(action: AgentAction, complete: boolean): Streaming<AgentAction> | null {
		const normalized = normalizeAction(action)
		const id = createdId(normalized)
		if (this.docCount > 0) {
			if (id === undefined) {
				// Can't tell yet whether this duplicates an earlier shape; wait for the id.
				if (!complete && isCreating(normalized)) return null
			} else if (this.priorIds.has(id)) {
				return null
			}
		}
		if (complete && id) this.currentIds.add(id)
		return { ...normalized, complete, time: Date.now() - this.startTime } as Streaming<AgentAction>
	}

	*push(text: string): Generator<Streaming<AgentAction>> {
		this.raw += text
		while (true) {
			const start = this.raw.indexOf('{', this.docFrom)
			if (start === -1) return
			const { value, end } = scanJson(this.raw.slice(start))
			const actions: AgentAction[] = value && Array.isArray(value.actions) ? value.actions : []

			// Every action before the last one is complete.
			while (this.cursor < actions.length - 1) {
				const done = actions[this.cursor]
				if (isAction(done)) {
					const out = this.emit(done, true)
					if (out) yield out
				}
				this.cursor++
				this.startTime = Date.now()
				this.last = null
			}

			const current = actions[this.cursor]
			if (end === -1) {
				if (isAction(current)) {
					this.last = current
					const out = this.emit(current, false)
					if (out) yield out
				}
				return
			}

			// This document is closed: complete its last action and look for another
			// (models occasionally restate their reply as a second JSON object).
			if (isAction(current)) {
				const out = this.emit(current, true)
				if (out) yield out
			}
			this.docFrom = start + end
			this.cursor = 0
			this.last = null
			this.docCount++
			for (const id of this.currentIds) this.priorIds.add(id)
			this.currentIds.clear()
		}
	}

	*finish(): Generator<Streaming<AgentAction>> {
		if (this.last) {
			const out = this.emit(this.last, true)
			if (out) yield out
		}
		this.last = null
		this.cursor++
	}
}

function isCreating(action: any): boolean {
	return action?._type === 'create' || action?._type === 'page' || action?._type === 'pen'
}

function createdId(action: any): string | undefined {
	if (action?._type === 'create') return action.shape?.shapeId
	if (action?._type === 'page' || action?._type === 'pen') return action.shapeId
	return undefined
}

function isAction(v: unknown): v is AgentAction {
	return !!v && typeof v === 'object' && typeof (v as any)._type === 'string'
}
