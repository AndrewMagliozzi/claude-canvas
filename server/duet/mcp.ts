import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { ROOT_DIR } from '../env'
import { CANVAS_KIT_REFERENCE, canvasTrayHtml } from '../../shared/canvasKit'
import { bridgeStatus, CanvasNotOpenError, sendToCanvas } from './bridge'
import { readManual, saveManual } from './manual'
import { transcribeHandwriting } from './transcribe'
import { estimateHeight, renderTemplate, TEMPLATE_DESCRIPTIONS, TEMPLATE_NAMES, TEMPLATE_SCHEMAS, TemplateName } from './templates'

/**
 * The Claude Duet connector: an MCP server (Streamable HTTP, stateless) that
 * lets Duet see and draw on the person's iPad canvas. Duet stays the brain and
 * the chat; the canvas is its whiteboard and the person's pen.
 *
 * Mounted at /mcp/<connector token>. No files, shell or local Claude access.
 */

const INSTRUCTIONS = `Claude Canvas is the person's iPad whiteboard, where they write and draw with an Apple Pencil. Use it the way a skilled executive assistant or chief of staff uses a sheet of paper: prepare the work, put the decision in front of them, and let them answer with a tick, a circle or a few words.

How to work:
- Don't make them ask for everything. When something needs them (a meeting coming up, a draft to approve, a decision, a pile of mail), prepare it and put it on the canvas, already filled in from their calendar, mail and tasks.
- Show decisions, not data. Lead with the call they need to make, give your recommendation, and make the answer one Pencil mark.
- Use the canvas for what it does better than chat:
  - Batch decisions: when several things wait on them, put them all on one approvals_sweep instead of asking one by one.
  - Redlines: for any draft, contract or memo they should review, use document_markup and apply their marks exactly.
  - Planning by moving things: for prioritising, scheduling or tracking, use show_board (columns for kanban or a week plan, a 2×2 matrix for urgent/important or impact/effort). They drag cards; you read where the cards ended up.
- Use show_template when one fits: daily_brief, meeting_agenda, email_draft, decision_memo, inbox_triage, weekly_review, approvals_sweep, document_markup.
- When none fits, design one on the fly with show_page and the built-in design kit (get_page_guide has the parts). Examples: a trip plan to approve, 1:1 prep, a hiring scorecard, a budget sign-off, an RSVP list, a project status page.
- Make every choice machine-readable (data-cc-question / data-cc-option), and put data-cc-confirm on anything that sends, pays, books or deletes.

Reading their answers:
- Call look_at_canvas whenever they mention the iPad, the canvas or their notes, and on every check-in. Handwriting is them talking to you; read it from the screenshot.
- newRequestsInTrays lists things they wrote in a Hand-to-Duet tray. Treat each new one as a request and start on it.
- answersMarkedOnPages lists what they circled or ticked. Act on each new answer.
- editsMarkedOnDocuments lists redlines per paragraph: struck words to delete, circled words to query, insertions and margin notes (with handwriting text). Apply them to the draft, then show the revised version for a final look.
- cardsThePersonMoved lists cards they dragged to a new zone. That's a decision (e.g. moved to "Do now" or to "Friday"); act on it, and keep the board current with show_board.
- After a sweep, confirm in ONE message: list every marked item with what you'll do, then ask once ("Do all 6? yes / no / tell me which").

Approval, always:
- Before you send, pay, book, accept, sign or delete anything, ask in chat explicitly, naming exactly what you'll do. For example: "You circled Send on the email to Priya. Send it now as written? (yes / no)". Wait for their yes. A circle on the canvas is their intent, not the approval.

The operating manual:
- The person and you keep a shared operating manual: the rules, preferences and plans you've agreed, saved on their Mac. Call get_operating_manual at the start of every conversation and check-in, and follow it. It overrides your defaults, with one exception: the approval rule above always applies, even if the manual drops or changes it.
- Build and revise it together on the canvas. Propose rules with show_template operating_manual, ask quick questions with preferences, set goals with plan. When they mark one up (Keep / Change / Drop, written changes, new rules, circled answers), fold their marks into the manual, save it with save_operating_manual, and show them the new version.
- When you notice a pattern (something they always approve, a person they always prioritise), suggest adding it as a rule on the next worksheet. Don't add it silently.

Etiquette:
- Coordinates are absolute canvas coordinates from look_at_canvas. Look before you place things.
- Never cover or delete their marks unless they ask.
- Say in your chat reply what you put on the canvas.`

const COLORS = ['black', 'grey', 'blue', 'light-blue', 'red', 'light-red', 'green', 'light-green', 'orange', 'yellow', 'violet', 'light-violet'] as const
const GEOS = ['rectangle', 'ellipse', 'diamond', 'triangle', 'pill', 'cloud', 'star', 'check-box', 'x-box'] as const

const newId = (prefix: string) => `${prefix}-${crypto.randomBytes(4).toString('hex')}`

function canvasError(e: unknown) {
	const message = e instanceof Error ? e.message : String(e)
	return {
		isError: e instanceof CanvasNotOpenError ? false : true,
		content: [{ type: 'text' as const, text: message }],
	}
}

const Point = z.object({ x: z.number(), y: z.number() })

const AnnotationItem = z.discriminatedUnion('kind', [
	z.object({
		kind: z.literal('text'),
		x: z.number().describe('Top-left x'),
		y: z.number().describe('Top-left y'),
		text: z.string(),
		color: z.enum(COLORS).optional(),
		size: z.enum(['s', 'm', 'l', 'xl']).optional(),
		maxWidth: z.number().optional().describe('Wrap text at this width'),
		id: z.string().optional(),
	}),
	z.object({
		kind: z.literal('sticky'),
		x: z.number(),
		y: z.number(),
		text: z.string().describe('A sticky note (200×200). Keep it very short.'),
		color: z.enum(COLORS).optional(),
		id: z.string().optional(),
	}),
	z.object({
		kind: z.literal('arrow'),
		x1: z.number(),
		y1: z.number(),
		x2: z.number(),
		y2: z.number(),
		fromId: z.string().optional().describe('Shape id the arrow starts at (binds to it)'),
		toId: z.string().optional().describe('Shape id the arrow points at (binds to it)'),
		label: z.string().optional(),
		color: z.enum(COLORS).optional(),
		id: z.string().optional(),
	}),
	z.object({
		kind: z.literal('pen'),
		points: z.array(Point).min(2).describe('A handwritten-looking stroke through these points: ticks, underlines, circles'),
		color: z.enum(COLORS).optional(),
		closed: z.boolean().optional(),
		id: z.string().optional(),
	}),
	z.object({
		kind: z.literal('shape'),
		geo: z.enum(GEOS),
		x: z.number(),
		y: z.number(),
		w: z.number(),
		h: z.number(),
		text: z.string().optional(),
		color: z.enum(COLORS).optional(),
		fill: z.enum(['none', 'tint', 'background', 'solid', 'pattern']).optional(),
		id: z.string().optional(),
	}),
	z.object({
		kind: z.literal('point'),
		points: z.array(Point).min(1).describe('A fading laser-pointer sweep; leaves nothing behind'),
	}),
	z.object({ kind: z.literal('move'), shapeId: z.string(), x: z.number(), y: z.number() }),
	z.object({ kind: z.literal('delete'), shapeId: z.string() }),
])

type Annotation = z.infer<typeof AnnotationItem>

/** Turn the connector's compact annotation items into the canvas's action format. */
function toActions(items: Annotation[], intent: string) {
	return items.map((item) => {
		switch (item.kind) {
			case 'text':
				return {
					_type: 'create',
					intent,
					shape: {
						_type: 'text',
						shapeId: item.id ?? newId('note'),
						anchor: 'top-left',
						color: item.color ?? 'blue',
						fontSize: { s: 18, m: 24, l: 36, xl: 48 }[item.size ?? 's'],
						maxWidth: item.maxWidth ?? null,
						note: 'from Claude Duet',
						text: item.text,
						x: item.x,
						y: item.y,
					},
				}
			case 'sticky':
				return {
					_type: 'create',
					intent,
					shape: { _type: 'note', shapeId: item.id ?? newId('sticky'), color: item.color ?? 'yellow', note: 'from Claude Duet', text: item.text, x: item.x, y: item.y },
				}
			case 'arrow':
				return {
					_type: 'create',
					intent,
					shape: {
						_type: 'arrow',
						shapeId: item.id ?? newId('arrow'),
						color: item.color ?? 'blue',
						fromId: item.fromId ?? null,
						toId: item.toId ?? null,
						note: 'from Claude Duet',
						text: item.label ?? '',
						x1: item.x1,
						y1: item.y1,
						x2: item.x2,
						y2: item.y2,
					},
				}
			case 'pen':
				return {
					_type: 'pen',
					intent,
					shapeId: item.id ?? newId('ink'),
					color: item.color ?? 'blue',
					closed: item.closed ?? false,
					fill: 'none',
					style: 'smooth',
					points: item.points,
				}
			case 'shape':
				return {
					_type: 'create',
					intent,
					shape: {
						_type: item.geo,
						shapeId: item.id ?? newId('shape'),
						color: item.color ?? 'blue',
						fill: item.fill ?? 'none',
						h: item.h,
						w: item.w,
						note: 'from Claude Duet',
						text: item.text ?? '',
						x: item.x,
						y: item.y,
					},
				}
			case 'point':
				return { _type: 'point', intent, points: item.points }
			case 'move':
				return { _type: 'move', intent, anchor: 'top-left', shapeId: item.shapeId, x: item.x, y: item.y }
			case 'delete':
				return { _type: 'delete', intent, shapeId: item.shapeId }
		}
	})
}

/** Append the standard Hand-to-Duet tray unless the page already has one. */
function withTray(html: string) {
	if (/data-cc-region=["']tray["']/.test(html)) return html
	const tray = canvasTrayHtml()
	if (/<\/main>/i.test(html)) return html.replace(/<\/main>(?![\s\S]*<\/main>)/i, `${tray}</main>`)
	if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `<div style="padding:0 56px 40px">${tray}</div></body>`)
	return `${html}<div style="padding:0 56px 40px">${tray}</div>`
}

/** Transcribed handwriting by mark id, so redlines keep their text on later looks. */
const markTranscripts = new Map<string, string>()

/** A one-line field list for a template schema, for tool descriptions and errors. */
function describeFields(schema: z.ZodObject<any>): string {
	return Object.entries(schema.shape)
		.map(([k, v]) => {
			const opt = (v as any).isOptional?.() ? '?' : ''
			const def = (v as any)._def
			const inner = def?.type === 'optional' ? def.innerType : v
			const kind = (inner as any)._def?.type ?? 'value'
			let shape = kind
			if (kind === 'array') {
				const el = (inner as any)._def.element
				shape = el?._def?.type === 'object' ? `[{${Object.keys(el.shape).join(', ')}}]` : '[string]'
			}
			return `${k}${opt}: ${shape}`
		})
		.join(', ')
}

function buildServer() {
	const server = new McpServer({ name: 'claude-canvas', version: '1.0.0' }, { instructions: INSTRUCTIONS })

	server.registerTool(
		'look_at_canvas',
		{
			title: 'Look at the iPad canvas',
			description:
				"See the person's iPad canvas: a screenshot of their current view, plus structured data. newHandwriting gives a transcription of everything they wrote since you last looked, with a close-up image of each patch so you can check it. The data covers the shapes in view (with who made each: 'person', 'claude' for the canvas's built-in assistant, or 'duet' for you), what they added or changed since you last looked, marks they made on your pages (with the page text under each mark), and anything they discussed with the canvas's built-in assistant since you last looked. Handwriting appears as draw shapes; read it from the screenshot.",
			inputSchema: {
				includeScreenshot: z.boolean().optional().describe('Default true. Set false for a quick check of changes only.'),
			},
			annotations: { readOnlyHint: true },
		},
		async ({ includeScreenshot }) => {
			try {
				const result = await sendToCanvas<{
					screenshot: string
					handwriting?: { id: string; where: string; bounds: unknown; shapeIds: string[]; image: string }[]
					data: Record<string, unknown>
				}>('look', { includeScreenshot }, 60_000)
				const content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[] = []
				const toImage = (dataUrl: string) => {
					const m = /^data:(image\/\w+);base64,(.+)$/s.exec(dataUrl ?? '')
					return m ? { type: 'image' as const, data: m[2], mimeType: m[1] } : null
				}
				const shot = toImage(result.screenshot)
				if (shot) content.push(shot)
				else if (includeScreenshot !== false) content.push({ type: 'text', text: '(The view is empty: nothing to screenshot.)' })

				// New handwriting: transcribed on the Mac, plus a close-up of each patch.
				const crops = result.handwriting ?? []
				const transcripts = await transcribeHandwriting(crops)
				const data: Record<string, unknown> = {}
				if (crops.length) {
					data.newHandwriting = crops.map((c) => {
						const t = transcripts.find((x) => x.id === c.id)
						return {
							where: c.where,
							...(t ? { text: t.text, confidence: t.confidence } : { text: null, note: 'Not transcribed; read it from the close-up image.' }),
							bounds: c.bounds,
							shapeIds: c.shapeIds,
						}
					})
				}
				Object.assign(data, result.data)
				// Attach transcribed handwriting to the redline it belongs to (insertions, margin notes).
				const edits = data.editsMarkedOnDocuments as { markId: string; handwriting?: string }[] | undefined
				for (const c of crops) {
					const t = transcripts.find((x) => x.id === c.id)
					if (t && !/^\[.*\]$/.test(t.text.trim())) for (const id of c.shapeIds) markTranscripts.set(id, t.text)
				}
				for (const e of edits ?? []) {
					const text = markTranscripts.get(e.markId)
					if (text) e.handwriting = text
				}
				// One edit per note: the strokes of a written word share a transcription.
				if (edits?.length) {
					const merged: typeof edits = []
					for (const e of edits as (typeof edits[number] & { paragraph?: number; meaning?: string; pageId?: string; markIds?: string[] })[]) {
						const same = e.handwriting
							? (merged as typeof e[]).find((m) => m.pageId === e.pageId && m.paragraph === e.paragraph && m.meaning === e.meaning && m.handwriting === e.handwriting)
							: null
						if (same) (same.markIds ??= [same.markId]).push(e.markId)
						else merged.push(e)
					}
					data.editsMarkedOnDocuments = merged
				}
				content.push({ type: 'text', text: JSON.stringify(data) })
				for (const [i, c] of crops.slice(0, 4).entries()) {
					const img = toImage(c.image)
					if (!img) continue
					content.push({ type: 'text', text: `Close-up ${i + 1} of new handwriting (${c.where}):` })
					content.push(img)
				}
				return { content }
			} catch (e) {
				return canvasError(e)
			}
		}
	)

	server.registerTool(
		'show_template',
		{
			title: 'Show a ready-made page on the iPad',
			description:
				"Put one of the canvas's ready-made templates on the person's iPad, filled with your data. The person answers with the Pencil (ticks, circled choices, write-in lines, the Hand-to-Duet tray), and look_at_canvas reports those marks back as answers. Templates:\n" +
				TEMPLATE_NAMES.map((n) => `- ${n}: ${TEMPLATE_DESCRIPTIONS[n]}`).join('\n') +
				"\nData fields per template:\n" +
				TEMPLATE_NAMES.map((n) => `- ${n}: ${describeFields(TEMPLATE_SCHEMAS[n])}`).join('\n') +
				'\nWhen none fits, design your own with show_page and the design kit (get_page_guide).',
			inputSchema: {
				template: z.enum(TEMPLATE_NAMES as [TemplateName, ...TemplateName[]]),
				data: z.record(z.string(), z.any()).describe('The fields for that template (see the description)'),
				pageId: z.string().optional().describe('Id of a page to replace, e.g. to refresh a brief'),
				x: z.number().optional(),
				y: z.number().optional(),
				focus: z.boolean().optional().describe("Move the person's view to the page. Default true."),
			},
		},
		async ({ template, data, pageId, x, y, focus }) => {
			const parsed = TEMPLATE_SCHEMAS[template].safeParse(data)
			if (!parsed.success) {
				return {
					isError: true,
					content: [{ type: 'text', text: `The data doesn't fit ${template}: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}. Fields: ${describeFields(TEMPLATE_SCHEMAS[template])}` }],
				}
			}
			const { title, html } = renderTemplate(template, parsed.data)
			const shapeId = pageId ?? newId(template.replace(/_/g, '-'))
			const actions: unknown[] = [
				{ _type: 'page', intent: title, shapeId, title, x, y, w: 720, h: estimateHeight(template, parsed.data), html },
			]
			if (focus !== false) {
				actions.push({ _type: 'pause', ms: 900 })
				actions.push({ _type: 'camera', intent: `Show ${title}`, shapeIds: [shapeId], durationMs: 700 })
			}
			try {
				const result = await sendToCanvas('apply', { actions })
				return { content: [{ type: 'text', text: JSON.stringify({ pageId: shapeId, template, ...result }) }] }
			} catch (e) {
				return canvasError(e)
			}
		}
	)

	server.registerTool(
		'show_board',
		{
			title: 'Show a movable board on the iPad',
			description:
				"Create or update a board of cards the person drags between zones with the Pencil: columns (a kanban: To do / Doing / Waiting / Done; or a week plan: Mon–Fri) or a 2×2 matrix (exactly 4 zones, in order top-left, top-right, bottom-left, bottom-right, e.g. Do now / Schedule / Delegate / Drop). look_at_canvas then reports where every card is and which ones they moved (cardsThePersonMoved). Send the same boardId to update it in place: cards are matched by id, new ones are added, and a card they moved stays where they put it unless you assign it a different zone than before.",
			inputSchema: {
				boardId: z.string().describe('Stable id, e.g. "week-plan" or "priorities"'),
				title: z.string(),
				layout: z.enum(['columns', 'matrix']),
				zones: z.array(z.string()).min(1).max(7),
				cards: z
					.array(z.object({ id: z.string(), title: z.string(), detail: z.string().optional(), zone: z.string() }))
					.max(40),
				x: z.number().optional(),
				y: z.number().optional(),
				focus: z.boolean().optional(),
			},
		},
		async ({ boardId, title, layout, zones, cards, x, y, focus }) => {
			const actions: unknown[] = [{ _type: 'board', intent: title, boardId, title, layout, zones, cards, x, y }]
			if (focus !== false) {
				const ids = [`board-${boardId.replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 40)}-title`, ...zones.map((_, i) => `board-${boardId.replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 40)}-zone-${i}`)]
				actions.push({ _type: 'camera', intent: `Show ${title}`, shapeIds: ids, durationMs: 700 })
			}
			try {
				const result = await sendToCanvas('apply', { actions })
				return { content: [{ type: 'text', text: JSON.stringify({ boardId, ...result }) }] }
			} catch (e) {
				return canvasError(e)
			}
		}
	)

	server.registerTool(
		'show_page',
		{
			title: 'Show a page on the iPad',
			description:
				"Put a rich page on the person's iPad canvas, e.g. a template of your own design when show_template has none that fits. The design kit's classes (cc-page, cc-title, cc-box, cc-choices, cc-tray…) are built in: read get_page_guide first. The page is your complete, self-contained HTML document (inline CSS, optional JS and inline SVG; no external resources), rendered in a sandbox. The person can write on it with the Pencil, and you'll see their marks via look_at_canvas. The page auto-fits its height. By default it's placed in open space in their view, and their view moves to it. To revise a page, pass its pageId. Read get_page_guide first.",
			inputSchema: {
				title: z.string(),
				html: z.string().describe('Complete HTML document. Design for the given width.'),
				width: z.number().optional().describe('Layout width in px, usually 480–880. Default 720.'),
				heightEstimate: z.number().optional().describe('Your best guess of the height in px. Default 600.'),
				x: z.number().optional().describe('Top-left x (absolute canvas coordinates). Omit to auto-place.'),
				y: z.number().optional(),
				pageId: z.string().optional().describe('Id of an existing page to replace its content'),
				focus: z.boolean().optional().describe("Move the person's view to the page. Default true."),
				tray: z.boolean().optional().describe('Add the Hand-to-Duet tray at the bottom (default true)'),
			},
		},
		async ({ title, html: rawHtml, width, heightEstimate, x, y, pageId, focus, tray }) => {
			const html = tray === false ? rawHtml : withTray(rawHtml)
			const shapeId = pageId ?? newId('page')
			const actions: unknown[] = [
				{ _type: 'page', intent: title, shapeId, title, x, y, w: width ?? 720, h: heightEstimate ?? 600, html },
			]
			// Give the page a moment to load and fit its height before framing it.
			if (focus !== false) actions.push({ _type: 'pause', ms: 900 })
			if (focus !== false) actions.push({ _type: 'camera', intent: `Show ${title}`, shapeIds: [shapeId], durationMs: 700 })
			try {
				const result = await sendToCanvas('apply', { actions })
				return { content: [{ type: 'text', text: JSON.stringify({ pageId: shapeId, ...result }) }] }
			} catch (e) {
				return canvasError(e)
			}
		}
	)

	server.registerTool(
		'annotate',
		{
			title: 'Write or draw on the iPad canvas',
			description:
				"Add margin notes, sticky notes, arrows, pen strokes (ticks, underlines, circles), simple shapes or a laser-pointer sweep to the person's canvas; or move/delete shapes you made. Use absolute canvas coordinates from look_at_canvas. Put notes beside their writing, never on top of it. Blue is the default ink so your marks stand apart from theirs.",
			inputSchema: {
				items: z.array(AnnotationItem).min(1),
				intent: z.string().optional().describe('One line on what this is for (shown in the canvas history)'),
				focusIds: z.array(z.string()).optional().describe("Shape ids to move the person's view to afterwards"),
			},
		},
		async ({ items, intent, focusIds }) => {
			const actions: unknown[] = toActions(items, intent ?? 'Annotation from Claude Duet')
			if (focusIds?.length) actions.push({ _type: 'camera', intent: 'Show the annotation', shapeIds: focusIds, durationMs: 600 })
			try {
				const result = await sendToCanvas('apply', { actions })
				return { content: [{ type: 'text', text: JSON.stringify(result) }] }
			} catch (e) {
				return canvasError(e)
			}
		}
	)

	server.registerTool(
		'move_view',
		{
			title: "Move the person's view",
			description: "Animate the iPad's view to frame some shapes, or a region in absolute canvas coordinates.",
			inputSchema: {
				shapeIds: z.array(z.string()).optional(),
				x: z.number().optional(),
				y: z.number().optional(),
				w: z.number().optional(),
				h: z.number().optional(),
			},
		},
		async (args) => {
			try {
				const result = await sendToCanvas('apply', { actions: [{ _type: 'camera', intent: 'Move view', durationMs: 700, ...args }] })
				return { content: [{ type: 'text', text: JSON.stringify(result) }] }
			} catch (e) {
				return canvasError(e)
			}
		}
	)

	server.registerTool(
		'get_operating_manual',
		{
			title: 'Read the operating manual',
			description:
				"The rules, preferences and plans you and the person have agreed on the canvas, saved on their Mac. Read it at the start of every conversation and check-in, and follow it; it overrides your defaults. Empty means you haven't set one up yet: offer to, with show_template operating_manual.",
			annotations: { readOnlyHint: true },
		},
		async () => {
			const m = readManual()
			return {
				content: [
					{
						type: 'text',
						text: m.markdown
							? `Operating manual v${m.version} (updated ${m.updatedAt}):\n\n${m.markdown}`
							: 'No operating manual yet. Offer to set one up together: propose rules with show_template operating_manual, and ask quick questions with preferences.',
					},
				],
			}
		}
	)

	server.registerTool(
		'save_operating_manual',
		{
			title: 'Save the operating manual',
			description:
				'Replace the operating manual with a new version, as Markdown: ## sections (e.g. Approvals, Calendar, Communication, People, Check-ins, Preferences, Plan) with one rule per bullet. Fold in exactly what the person marked on the worksheets (kept, changed, dropped, added, answered); never invent rules they didn\'t agree to. Earlier versions are kept. Afterwards, tell them what changed and show the new version with show_template operating_manual.',
			inputSchema: {
				markdown: z.string().min(1),
				summary: z.string().describe('One line on what changed, e.g. "Dropped rule 3, added a $200 spend limit"'),
			},
		},
		async ({ markdown, summary }) => {
			const { version } = saveManual(markdown, summary)
			return { content: [{ type: 'text', text: `Saved operating manual v${version}. ${summary}` }] }
		}
	)

	server.registerTool(
		'get_page_guide',
		{
			title: 'Get the page guide',
			description: 'How to design pages for the iPad canvas: choosing the form, the built-in design kit (classes and answer hooks), and leaving room for the pen. Read it once per conversation before your first show_page.',
			annotations: { readOnlyHint: true },
		},
		async () => {
			let guide = ''
			try {
				guide = fs.readFileSync(path.join(ROOT_DIR, 'PAGE_GUIDE.md'), 'utf8')
			} catch {
				guide = 'Page guide not found.'
			}
			const status = bridgeStatus()
			return {
				content: [
					{
						type: 'text',
						text: `${guide}\n\n${CANVAS_KIT_REFERENCE}\n\n## Notes for Claude Duet\n\n- In this guide, "a \`page\`" means your show_page tool; margin notes, arrows and pen marks mean annotate; camera moves mean move_view (or show_page's focus). Ignore mentions of other action names.\n- Canvases connected right now: ${status.connectedCanvases}.`,
					},
				],
			}
		}
	)

	return server
}

/** For tests: the MCP server without HTTP. */
export const buildServerForTest = () => buildServer()

/** Handle POST/GET/DELETE on /mcp/<token> (stateless Streamable HTTP). */
export async function handleMcp(req: IncomingMessage, res: ServerResponse, body: unknown) {
	const server = buildServer()
	const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
	res.on('close', () => {
		void transport.close()
		void server.close()
	})
	await server.connect(transport)
	await transport.handleRequest(req, res, body)
}
