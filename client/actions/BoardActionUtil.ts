import { Box, Editor, TLShape, TLShapeId, toRichText } from 'tldraw'
import { BoardAction } from '../../shared/schema/AgentActionSchemas'
import { Streaming } from '../../shared/types/Streaming'
import { AgentHelpers } from '../AgentHelpers'
import { getSafePageBounds } from '../state'
import { AgentActionUtil, registerActionUtil } from './AgentActionUtil'

/**
 * Movable boards: zones (columns or a 2×2 matrix) holding cards the person can
 * drag with the Pencil. Cards are ordinary tldraw shapes tagged with board
 * metadata, so where a card sits is the answer: Duet reads which zone each
 * card is in (see readBoards).
 */

const ZONE_W = 250
const ZONE_GAP = 20
const CARD_W = 226
const CARD_H = 72
const HEADER = 56
const MATRIX_W = 460
const MATRIX_H = 320

const slug = (s: string) => s.replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 40) || 'x'
const zoneId = (b: string, i: number) => `shape:board-${slug(b)}-zone-${i}` as TLShapeId
const cardId = (b: string, c: string) => `shape:card-${slug(b)}-${slug(c)}` as TLShapeId
const titleId = (b: string) => `shape:board-${slug(b)}-title` as TLShapeId

export const BoardActionUtil = registerActionUtil(
	class BoardActionUtil extends AgentActionUtil<BoardAction> {
		static override type = 'board' as const

		override getInfo(action: Streaming<BoardAction>) {
			return { icon: 'note' as const, description: `**Board: ${action.title ?? ''}**${action.intent ? ` — ${action.intent}` : ''}` }
		}

		override getStatusText(action: Streaming<BoardAction>) {
			return `Laying out the board “${action.title ?? ''}”…`
		}

		override applyAction(action: Streaming<BoardAction>, helpers: AgentHelpers) {
			if (!action.complete) return
			const { editor } = this
			const zones = action.zones.slice(0, action.layout === 'matrix' ? 4 : 7)
			const existingTitle = editor.getShape(titleId(action.boardId))

			// Where the board goes: where it already is, the given spot, or open space in view.
			let origin: { x: number; y: number }
			if (existingTitle) origin = { x: existingTitle.x, y: existingTitle.y }
			else if (typeof action.x === 'number' && typeof action.y === 'number') origin = helpers.removeOffsetFromVec({ x: action.x, y: action.y })
			else origin = openSpot(editor, boardSize(action.layout, zones.length))

			// Title
			const titleShape = {
				id: titleId(action.boardId),
				type: 'text' as const,
				x: origin.x,
				y: origin.y,
				isLocked: true,
				props: { richText: toRichText(action.title), size: 'l' as const, font: 'serif' as const, color: 'black' as const, autoSize: true },
				meta: { ccBoardTitle: action.boardId, layout: action.layout, zones },
			}
			if (existingTitle) editor.updateShape({ ...titleShape, isLocked: true })
			else editor.createShape(titleShape)

			// Zones (rebuilt in place, behind the cards)
			const zoneBoxes = zones.map((_, i) => zoneBox(action.layout, origin, i))
			zones.forEach((name, i) => {
				const b = zoneBoxes[i]
				const id = zoneId(action.boardId, i)
				const shape = {
					id,
					type: 'geo' as const,
					x: b.x,
					y: b.y,
					isLocked: true,
					props: {
						geo: 'rectangle' as const,
						w: b.w,
						h: b.h,
						dash: 'dashed' as const,
						color: 'grey' as const,
						fill: 'none' as const,
						size: 's' as const,
						richText: toRichText(name),
						align: 'start' as const,
						verticalAlign: 'start' as const,
						labelColor: 'grey' as const,
						font: 'sans' as const,
					},
					meta: { ccBoard: action.boardId, ccZone: name },
				}
				if (editor.getShape(id)) editor.updateShape(shape)
				else editor.createShape(shape)
				editor.sendToBack([id])
			})
			// Remove zones beyond the new count.
			for (let i = zones.length; i < 8; i++) {
				const id = zoneId(action.boardId, i)
				if (editor.getShape(id)) editor.deleteShapes([id])
			}

			// Cards
			for (const card of action.cards) {
				const zoneIndex = Math.max(0, zones.indexOf(card.zone))
				const zone = zones[zoneIndex]
				const id = cardId(action.boardId, card.id)
				const text = card.detail ? `${card.title}\n${card.detail}` : card.title
				const existing = editor.getShape(id)
				const style = {
					geo: 'rectangle' as const,
					w: CARD_W,
					dash: 'solid' as const,
					color: 'blue' as const,
					fill: 'semi' as const,
					size: 's' as const,
					font: 'sans' as const,
					richText: toRichText(text),
					align: 'start' as const,
					verticalAlign: 'start' as const,
					labelColor: 'black' as const,
				}
				if (existing) {
					const current = zoneOfShape(editor, action.boardId, existing)
					const assignedBefore = existing.meta.duetZone as string | undefined
					// Duet changed its mind about the zone: move it. Otherwise the person's placement stands.
					const move = zone !== assignedBefore && zone !== current
					const pos = move ? nextSlot(editor, action.boardId, zoneBoxes[zoneIndex], id) : null
					editor.updateShape({
						id,
						type: 'geo',
						...(pos ?? {}),
						props: { ...style, h: (existing.props as { h: number }).h },
						meta: { ...existing.meta, title: card.title, duetZone: move || zone === current ? zone : assignedBefore },
					})
				} else {
					const pos = nextSlot(editor, action.boardId, zoneBoxes[zoneIndex], id)
					editor.createShape({
						id,
						type: 'geo',
						x: pos.x,
						y: pos.y,
						props: { ...style, h: CARD_H },
						meta: { ccBoard: action.boardId, ccCard: card.id, title: card.title, duetZone: zone },
					})
				}
			}
		}
	}
)

function boardSize(layout: 'columns' | 'matrix', n: number) {
	return layout === 'matrix' ? { w: MATRIX_W * 2 + ZONE_GAP, h: 60 + MATRIX_H * 2 + ZONE_GAP } : { w: n * ZONE_W + (n - 1) * ZONE_GAP, h: 60 + 520 }
}

function zoneBox(layout: 'columns' | 'matrix', origin: { x: number; y: number }, i: number) {
	const top = origin.y + 60
	if (layout === 'matrix') {
		const col = i % 2
		const row = Math.floor(i / 2)
		return new Box(origin.x + col * (MATRIX_W + ZONE_GAP), top + row * (MATRIX_H + ZONE_GAP), MATRIX_W, MATRIX_H)
	}
	return new Box(origin.x + i * (ZONE_W + ZONE_GAP), top, ZONE_W, 520)
}

/** The top-left for a new card in a zone: below the cards already there (wrapping into columns in a matrix). */
function nextSlot(editor: Editor, boardId: string, zone: Box, exclude: TLShapeId) {
	const inZone = boardCards(editor, boardId)
		.filter((s) => s.id !== exclude)
		.map((s) => editor.getShapePageBounds(s)!)
		.filter((b) => b && zone.containsPoint(b.center))
	const cols = Math.max(1, Math.floor((zone.w - 12) / (CARD_W + 12)))
	const slots = inZone.length
	const col = slots % cols
	const row = Math.floor(slots / cols)
	const lowestInCol = inZone.filter((b) => Math.abs(b.x - (zone.x + 12 + col * (CARD_W + 12))) < CARD_W / 2).reduce((m, b) => Math.max(m, b.maxY), 0)
	const y = Math.max(zone.y + HEADER, lowestInCol ? lowestInCol + 12 : zone.y + HEADER + row * (CARD_H + 12))
	return { x: zone.x + 12 + col * (CARD_W + 12), y }
}

function boardCards(editor: Editor, boardId: string) {
	return editor.getCurrentPageShapes().filter((s) => s.meta?.ccBoard === boardId && typeof s.meta?.ccCard === 'string')
}

/** Which zone (by name) the shape's centre is in, or null if it's off the board. */
export function zoneOfShape(editor: Editor, boardId: string, shape: TLShape): string | null {
	const b = editor.getShapePageBounds(shape)
	if (!b) return null
	for (const z of editor.getCurrentPageShapes()) {
		if (z.meta?.ccBoard !== boardId || typeof z.meta?.ccZone !== 'string') continue
		const zb = editor.getShapePageBounds(z)
		if (zb && zb.containsPoint(b.center)) return z.meta.ccZone as string
	}
	return null
}

/** Every board on the page with its cards by zone. */
export function readBoards(editor: Editor) {
	const titles = editor.getCurrentPageShapes().filter((s) => typeof s.meta?.ccBoardTitle === 'string')
	return titles.map((t) => {
		const boardId = t.meta.ccBoardTitle as string
		const zones = (t.meta.zones as string[]) ?? []
		const byZone: Record<string, string[]> = Object.fromEntries(zones.map((z) => [z, []]))
		const offBoard: string[] = []
		const cards = boardCards(editor, boardId).map((c) => {
			const zone = zoneOfShape(editor, boardId, c)
			const title = (c.meta.title as string) ?? ''
			if (zone && byZone[zone]) byZone[zone].push(title)
			else offBoard.push(title)
			return { cardId: c.meta.ccCard as string, title, zone, assignedByDuet: (c.meta.duetZone as string) ?? null }
		})
		return { boardId, title: editor.getShapeUtil(t).getText(t) ?? '', layout: t.meta.layout as string, zones: byZone, offBoard, cards }
	})
}

function openSpot(editor: Editor, size: { w: number; h: number }) {
	const view = getSafePageBounds(editor)
	const inView = editor
		.getCurrentPageShapes()
		.map((s) => editor.getShapePageBounds(s))
		.filter((b): b is Box => !!b && b.collides(view))
	if (!inView.length) return { x: view.x + 40, y: view.y + 40 }
	const content = Box.Common(inView)
	return { x: content.maxX + 80, y: Math.max(content.y, view.y + 40) }
}
