import { Box, Editor, FileHelpers, RecordsDiff, TLRecord, TLShape, TLShapeId } from 'tldraw'
import { convertTldrawShapeToBlurryShape } from '../../shared/format/convertTldrawShapeToBlurryShape'
import { AgentAction } from '../../shared/types/AgentAction'
import { AgentRequest } from '../../shared/types/AgentRequest'
import { Streaming } from '../../shared/types/Streaming'
import { getToken } from '../api'
import { AgentHelpers } from '../AgentHelpers'
import type { TldrawAgent } from '../agent/TldrawAgent'
import { readBoards } from '../actions/BoardActionUtil'
import { summarizeUserChanges } from '../parts/UserActionHistoryPartUtil'
import { getSafePageBounds, getVisiblePageBounds } from '../state'

/**
 * The browser half of the Claude Duet connector.
 *
 * Duet (in Anthropic's cloud) calls MCP tools on the Mac server; the server
 * forwards each call here over server-sent events, and this page answers by
 * POSTing back. Two commands:
 *
 *   look  → screenshot + shapes + what the person changed since Duet last looked
 *           + marks on pages + recent exchanges with the canvas's own Claude
 *   apply → run a list of canvas actions (same format the local Claude uses),
 *           in absolute canvas coordinates
 */

type Command =
	| { id: string; type: 'look'; args: { includeScreenshot?: boolean } }
	| { id: string; type: 'apply'; args: { actions: AgentAction[]; autoPlace?: boolean } }

/** Changes the person made since Duet last looked (independent of the local Claude's tracking). */
let duetDiffs: RecordsDiff<TLRecord>[] = []
/** Index into the local chat history at Duet's last look. */
let lastSeenChatIndex = 0
/** Card → zone as last reported to Duet, so moves are reported once. */
const reportedCardZones = new Map<string, string | null>()
/** Marks Duet has already been told about, so answers and requests are flagged new only once. */
const reportedMarks = new Set<string>()

export function installDuetBridge(agent: TldrawAgent) {
	const { editor } = agent
	let source: EventSource | null = null
	let stopped = false
	let retry: ReturnType<typeof setTimeout> | null = null
	let clientId: string | null = null

	// Track the person's own edits for Duet.
	const record = (diff: RecordsDiff<TLRecord>) => {
		if (agent.getIsActingOnEditor()) return
		duetDiffs.push(diff)
	}
	const offCreate = editor.sideEffects.registerAfterCreateHandler('shape', (shape, src) => {
		if (src === 'user') record({ added: { [shape.id]: shape }, updated: {}, removed: {} })
	})
	const offChange = editor.sideEffects.registerAfterChangeHandler('shape', (prev, next, src) => {
		if (src === 'user') record({ added: {}, updated: { [prev.id]: [prev, next] }, removed: {} })
	})
	const offDelete = editor.sideEffects.registerAfterDeleteHandler('shape', (shape, src) => {
		if (src === 'user') record({ added: {}, updated: {}, removed: { [shape.id]: shape } })
	})

	const connect = () => {
		if (stopped) return
		const token = getToken()
		if (!token) {
			// Not unlocked yet: check again shortly (connects right after the passcode is entered).
			retry = setTimeout(connect, 300)
			return
		}
		source = new EventSource(`/api/bridge?token=${encodeURIComponent(token)}`)
		source.onmessage = (e) => {
			let cmd: Command
			try {
				cmd = JSON.parse(e.data)
			} catch {
				return
			}
			if ((cmd as any).type === 'hello') {
				clientId = (cmd as any).clientId
				ping()
				return
			}
			void handle(agent, cmd).then(
				(result) => reply(cmd.id, true, result),
				(err) => reply(cmd.id, false, { error: err?.message ?? String(err) })
			)
		}
		source.onerror = () => {
			source?.close()
			source = null
			if (!stopped) retry = setTimeout(connect, 3000)
		}
	}

	// Tell the server which open canvas is the one in use (iPad vs. Mac).
	const ping = () => {
		const token = getToken()
		if (!token || !clientId || document.visibilityState !== 'visible') return
		void fetch('/api/bridge/active', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
			body: JSON.stringify({ clientId }),
		}).catch(() => {})
	}
	let lastPing = 0
	const onActivity = () => {
		if (Date.now() - lastPing < 5000) return
		lastPing = Date.now()
		ping()
	}
	window.addEventListener('pointerdown', onActivity, { capture: true })
	document.addEventListener('visibilitychange', onActivity)

	connect()
	return () => {
		stopped = true
		if (retry) clearTimeout(retry)
		source?.close()
		offCreate()
		offChange()
		offDelete()
		window.removeEventListener('pointerdown', onActivity, { capture: true })
		document.removeEventListener('visibilitychange', onActivity)
	}
}

function reply(id: string, ok: boolean, result: unknown) {
	const token = getToken()
	void fetch('/api/bridge/result', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
		body: JSON.stringify({ id, ok, result }),
	}).catch(() => {})
}

/** Helpers with no chat-origin offset: Duet works in absolute canvas coordinates. */
function absoluteHelpers(agent: TldrawAgent) {
	const helpers = new AgentHelpers(agent)
	helpers.offset = { x: 0, y: 0 }
	return helpers
}

async function handle(agent: TldrawAgent, cmd: Command): Promise<unknown> {
	switch (cmd.type) {
		case 'look':
			return look(agent, cmd.args?.includeScreenshot !== false)
		case 'apply':
			return apply(agent, cmd.args.actions ?? [], cmd.args.autoPlace !== false)
		default:
			throw new Error('Unknown command')
	}
}

async function look(agent: TldrawAgent, includeScreenshot: boolean) {
	const { editor } = agent
	const helpers = absoluteHelpers(agent)
	const view = getSafePageBounds(editor)
	const visible = getVisiblePageBounds(editor)
	const request: AgentRequest = {
		agentMessages: [],
		userMessages: [],
		bounds: visible,
		data: [],
		source: 'other-agent',
		contextItems: [],
	}

	const screenshot = includeScreenshot
		? ((await agent.getPromptPartUtil('screenshot').getPart(request, helpers)) as { screenshot: string }).screenshot
		: ''
	const pageMarks = (await agent.getPromptPartUtil('pageMarks').getPart(request, helpers)) as {
		pages: unknown[]
	}

	const shapesInView = editor
		.getCurrentPageShapesSorted()
		.filter((s) => {
			const b = editor.getShapeMaskedPageBounds(s)
			return !!b && b.collides(visible)
		})
		.map((s) => {
			const blurry = convertTldrawShapeToBlurryShape(editor, s)
			if (!blurry) return null
			return { ...blurry, by: (s.meta?.by as string) ?? 'person' }
		})
		.filter(Boolean)

	// Ink added or extended since Duet last looked, grouped into patches of handwriting.
	const newInkIds = new Set<TLShapeId>()
	for (const d of duetDiffs) {
		for (const s of Object.values(d.added)) if (s.typeName === 'shape') newInkIds.add(s.id as TLShapeId)
		for (const [, s] of Object.values(d.updated)) if (s.typeName === 'shape') newInkIds.add(s.id as TLShapeId)
	}
	const handwriting = await cropHandwriting(editor, [...newInkIds], pageMarksRegions(pageMarks.pages as any[]))

	const changes = summarizeUserChanges(editor, helpers, duetDiffs)
	duetDiffs = []

	// What the person discussed with the canvas's own (local) Claude since Duet last looked.
	const history = agent.chat.getHistory()
	const canvasChat: string[] = []
	for (const item of history.slice(lastSeenChatIndex)) {
		if (item.type === 'prompt' && item.promptSource === 'user') {
			const text = item.userFacingMessage ?? item.agentFacingMessage
			if (text) canvasChat.push(`Person: ${text}`)
		} else if (item.type === 'action' && item.action._type === 'message' && item.action.text) {
			canvasChat.push(`Canvas Claude: ${item.action.text}`)
		}
	}
	lastSeenChatIndex = history.length

	// Turn Pencil marks into answers and requests Duet can act on.
	type Mark = { shapeId: string; over: string[]; kind?: string; words?: string; choice?: { question: string | null; option: string; confirm: boolean }; region?: string }
	type PageMarks = { shapeId: string; title: string; marks: Mark[] }
	const pages = pageMarks.pages as PageMarks[]
	const answers = pages.flatMap((p) =>
		p.marks
			.filter((m) => m.choice)
			.map((m) => ({
				isNew: !reportedMarks.has(m.shapeId),
				page: p.title,
				pageId: p.shapeId,
				question: m.choice!.question,
				answer: m.choice!.option,
				...(m.choice!.confirm ? { actsOutsideTheCanvas: true, beforeActing: 'Ask the person explicitly in chat to confirm, naming exactly what you will do.' } : {}),
			}))
	)
	const requests = pages.flatMap((p) =>
		p.marks
			.filter((m) => m.region === 'tray')
			.map((m) => ({ isNew: !reportedMarks.has(m.shapeId), page: p.title, pageId: p.shapeId, markId: m.shapeId, note: 'Handwriting in the Hand-to-Duet tray: read it from the screenshot and treat it as a request.' }))
	)

	// Redlines on document pages: each mark on a paragraph or its margin becomes an edit.
	const edits = pages.flatMap((p) =>
		p.marks
			.filter((m) => /^(para|margin):\d+$/.test(m.region ?? ''))
			.map((m) => {
				const [area, n] = (m.region as string).split(':')
				const inMargin = area === 'margin'
				const words = m.words ?? ''
				const meaning = inMargin
					? 'margin note'
					: m.kind === 'line' && words
						? 'delete these words (struck through)'
						: m.kind === 'circle' && words
							? 'query or flag these words (circled)'
							: m.kind === 'writing' && !words
								? 'insertion written between the lines'
								: words
									? 'marked these words'
									: 'mark'
				return { isNew: !reportedMarks.has(m.shapeId), page: p.title, pageId: p.shapeId, paragraph: Number(n), meaning, ...(words ? { words } : {}), markId: m.shapeId }
			})
	)

	for (const p of pages) for (const m of p.marks) reportedMarks.add(m.shapeId)

	// Boards: where every card is now, and cards the person moved since Duet last looked.
	const boards = readBoards(editor)
	const cardMoves = boards.flatMap((b) =>
		b.cards
			.filter((c) => {
				const key = `${b.boardId}/${c.cardId}`
				const before = reportedCardZones.has(key) ? reportedCardZones.get(key) : c.assignedByDuet
				return c.zone !== before
			})
			.map((c) => {
				const key = `${b.boardId}/${c.cardId}`
				const from = reportedCardZones.has(key) ? reportedCardZones.get(key) : c.assignedByDuet
				return { board: b.title, boardId: b.boardId, cardId: c.cardId, card: c.title, from, to: c.zone ?? 'off the board' }
			})
	)
	for (const b of boards) for (const c of b.cards) reportedCardZones.set(`${b.boardId}/${c.cardId}`, c.zone)

	return {
		screenshot,
		handwriting,
		data: {
			...(edits.length ? { editsMarkedOnDocuments: edits } : {}),
			...(cardMoves.length ? { cardsThePersonMoved: cardMoves } : {}),
			...(requests.length ? { newRequestsInTrays: requests } : {}),
			...(answers.length ? { answersMarkedOnPages: answers } : {}),
			page: editor.getCurrentPage().name,
			otherPages: editor
				.getPages()
				.filter((p) => p.id !== editor.getCurrentPageId())
				.map((p) => p.name),
			view: helpers.roundBox(view),
			shapesInView,
			changesSinceYouLastLooked: changes,
			marksOnPages: pageMarks.pages,
			...(boards.length ? { boards: boards.map(({ cards, ...b }) => b) } : {}),
			canvasChatSinceYouLastLooked: canvasChat,
		},
	}
}

/**
 * Apply actions from Duet, in order, waiting for camera moves etc. Pages
 * without a position are placed in open space in the person's view.
 */
async function apply(agent: TldrawAgent, actions: AgentAction[], autoPlace: boolean) {
	const { editor } = agent
	const helpers = absoluteHelpers(agent)
	const created: string[] = []
	const errors: string[] = []
	const before = new Set(editor.getCurrentPageShapeIds())

	for (const raw of actions) {
		const action = { ...raw, complete: true, time: 0 } as Streaming<AgentAction>
		if (autoPlace && action._type === 'page' && (typeof action.x !== 'number' || typeof action.y !== 'number')) {
			const spot = findOpenSpot(agent, action.w ?? 720, action.h ?? 480)
			action.x = spot.x
			action.y = spot.y
		}
		const util = agent.actions.getAgentActionUtil(action._type)
		if (!util) {
			errors.push(`Unknown action ${action._type}`)
			continue
		}
		let promise = null as Promise<void> | null
		agent.actingAs = 'duet'
		agent.setIsActingOnEditor(true)
		try {
			editor.run(
				() => {
					// Errors must not escape editor.run (tldraw would crash the canvas).
					try {
						const sanitized = util.sanitizeAction(action, helpers)
						if (!sanitized) return
						const result = agent.actions.act(sanitized, helpers)
						promise = result.promise
					} catch (e: any) {
						errors.push(`${action._type}: ${e?.message ?? e}`)
					}
				},
				{ ignoreShapeLock: true, history: 'ignore' }
			)
		} catch (e: any) {
			errors.push(`${action._type}: ${e?.message ?? e}`)
		} finally {
			agent.setIsActingOnEditor(false)
			agent.actingAs = 'claude'
		}
		if (promise) await promise
	}

	for (const id of editor.getCurrentPageShapeIds()) if (!before.has(id)) created.push(id.slice('shape:'.length))
	// Errors reported by act() for skipped actions land in the local agent's notes.
	errors.push(...agent.takeNotes().filter((n) => n.includes('failed')))

	// Let the canvas's own Claude know Duet changed the canvas.
	if (actions.length) {
		agent.addNote(
			`Claude Duet (the person's main assistant) just changed the canvas: ${actions
				.map((a) => (a as any).intent || a._type)
				.slice(0, 8)
				.join('; ')}`
		)
	}
	return { applied: actions.length - errors.length, createdShapeIds: created, errors }
}

/** Top-left of an open area of size w×h near the person's view: right of what's there, else the view's top-left. */
function findOpenSpot(agent: TldrawAgent, w: number, h: number) {
	const { editor } = agent
	const view = getSafePageBounds(editor)
	const margin = 48
	const inView = editor
		.getCurrentPageShapes()
		.map((s) => editor.getShapePageBounds(s))
		.filter((b): b is Box => !!b && b.collides(view))
	if (inView.length === 0) return { x: view.x + margin, y: view.y + margin }
	const content = Box.Common(inView)
	// Prefer the right of the content, then below it.
	if (content.maxX + margin + w <= view.maxX + w * 0.5) return { x: content.maxX + margin, y: Math.max(content.y, view.y + margin) }
	return { x: content.x, y: content.maxY + margin }
}


/** Mark id → where it is ("the Hand-to-Duet tray on 'Email: …'", "on page 'Daily brief'"). */
function pageMarksRegions(pages: { title: string; marks: { shapeId: string; region?: string; over?: string[] }[] }[]) {
	const where = new Map<string, string>()
	for (const p of pages) {
		for (const m of p.marks) {
			const near = m.over?.[0] ? ` near "${m.over[0].slice(0, 60)}"` : ''
			where.set(
				m.shapeId,
				m.region === 'tray' ? `the Hand-to-Duet tray on "${p.title}"` : `on the page "${p.title}"${m.region ? ` in ${m.region}` : ''}${near}`
			)
		}
	}
	return where
}

export interface HandwritingCrop {
	id: string
	where: string
	/** Absolute canvas bounds of the patch. */
	bounds: { x: number; y: number; w: number; h: number }
	shapeIds: string[]
	image: string
}

const INK_TYPES = new Set(['draw', 'highlight'])
const GAP = 70 // strokes closer than this (canvas px) belong to the same patch of writing

/**
 * Group new ink strokes into patches (a word, a line, a note) and render each
 * one large, ink only on white, so handwriting is easy to read.
 */
async function cropHandwriting(editor: Editor, ids: TLShapeId[], where: Map<string, string>): Promise<HandwritingCrop[]> {
	const strokes = ids
		.map((id) => editor.getShape(id))
		.filter((s): s is TLShape => !!s && INK_TYPES.has(s.type) && !s.meta?.by)
		.map((s) => ({ shape: s, box: editor.getShapePageBounds(s)! }))
		.filter((s) => !!s.box)
	if (strokes.length === 0) return []

	// Union strokes whose (expanded) bounds overlap.
	const parent = strokes.map((_, i) => i)
	const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
	for (let i = 0; i < strokes.length; i++) {
		for (let j = i + 1; j < strokes.length; j++) {
			const a = strokes[i].box.clone().expandBy(GAP / 2)
			const b = strokes[j].box.clone().expandBy(GAP / 2)
			if (a.collides(b)) parent[find(i)] = find(j)
		}
	}
	const groups = new Map<number, typeof strokes>()
	strokes.forEach((s, i) => {
		const root = find(i)
		groups.set(root, [...(groups.get(root) ?? []), s])
	})

	const crops: HandwritingCrop[] = []
	const ordered = [...groups.values()].sort((a, b) => Box.Common(a.map((s) => s.box)).y - Box.Common(b.map((s) => s.box)).y)
	for (const group of ordered.slice(0, 8)) {
		const bounds = Box.Common(group.map((s) => s.box)).expandBy(16)
		const scale = Math.min(4, 1100 / Math.max(bounds.w, bounds.h))
		try {
			const { blob } = await editor.toImage(
				group.map((s) => s.shape.id),
				{ format: 'png', background: true, bounds, padding: 0, scale, pixelRatio: 1, darkMode: false }
			)
			const image = await FileHelpers.blobToDataUrl(blob)
			const tagged = group.map((s) => where.get(s.shape.id.slice('shape:'.length))).find(Boolean)
			crops.push({
				id: group[0].shape.id.slice('shape:'.length),
				where: tagged ?? 'on the canvas',
				bounds: { x: Math.round(bounds.x), y: Math.round(bounds.y), w: Math.round(bounds.w), h: Math.round(bounds.h) },
				shapeIds: group.map((s) => s.shape.id.slice('shape:'.length)),
				image,
			})
		} catch (e) {
			console.warn('Could not crop handwriting', e)
		}
	}
	return crops
}
