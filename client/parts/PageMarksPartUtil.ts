import { b64Vecs, Box, Editor, TLDrawShape, TLShape } from 'tldraw'
import { convertTldrawIdToSimpleId } from '../../shared/format/convertTldrawShapeToFocusedShape'
import { PageMarksPart } from '../../shared/schema/PromptPartDefinitions'
import { AgentRequest } from '../../shared/types/AgentRequest'
import { HTML_PAGE_TYPE } from '../shapes/HtmlPageShapeUtil'
import { hitTestPage, takePageErrors } from '../shapes/pageBridge'
import { PromptPartUtil, registerPromptPartUtil } from './PromptPartUtil'

/**
 * Tells Claude what the user drew on top of its HTML pages: each mark's box in
 * page-local coordinates plus the page text underneath it (via a hit test
 * inside the sandboxed iframe). Also reports script errors from pages.
 */
export const PageMarksPartUtil = registerPromptPartUtil(
	class PageMarksPartUtil extends PromptPartUtil<PageMarksPart> {
		static override type = 'pageMarks' as const

		override async getPart(request: AgentRequest): Promise<PageMarksPart> {
			const { editor } = this
			const view = Box.From(request.bounds)
			const all = editor.getCurrentPageShapesSorted()
			const pages = all.filter((s) => s.type === HTML_PAGE_TYPE)
			const out: PageMarksPart['pages'] = []

			for (const page of pages) {
				const pageBounds = editor.getShapePageBounds(page)
				if (!pageBounds) continue
				const scriptErrors = takePageErrors(page.id)
				if (!pageBounds.collides(view) && scriptErrors.length === 0) continue

				const marks = all.filter((s) => isUserMarkOn(editor, s, page, pageBounds))
				const boxes = marks.map((m) => {
					const b = editor.getShapePageBounds(m)!
					return {
						x: Math.round(b.x - pageBounds.x),
						y: Math.round(b.y - pageBounds.y),
						w: Math.round(b.w),
						h: Math.round(b.h),
					}
				})
				const hits = await hitTestPage(page.id, boxes)
				out.push({
					shapeId: convertTldrawIdToSimpleId(page.id),
					title: (page.props as { title: string }).title,
					marks: marks.map((m, i) => {
						const text = editor.getShapeUtil(m).getText(m)
						return {
							shapeId: convertTldrawIdToSimpleId(m.id),
							type: m.type,
							box: boxes[i],
							...(text ? { text } : {}),
							over: hits[i]?.texts ?? [],
							...(classifyMark(editor, m) ? { kind: classifyMark(editor, m)! } : {}),
							...(hits[i]?.words ? { words: hits[i].words } : {}),
							...(hits[i]?.choice ? { choice: hits[i].choice! } : {}),
							...(hits[i]?.region ? { region: hits[i].region! } : {}),
						}
					}),
					scriptErrors,
				})
			}
			return { type: 'pageMarks', pages: out }
		}
	}
)

function isUserMarkOn(editor: import('tldraw').Editor, shape: TLShape, page: TLShape, pageBounds: Box) {
	if (shape.id === page.id) return false
	if (shape.meta?.by) return false // made by Claude or Duet, not by hand
	if (shape.type === HTML_PAGE_TYPE || shape.type === 'group') return false
	const b = editor.getShapePageBounds(shape)
	if (!b || !b.collides(pageBounds)) return false
	// Must be drawn above the page.
	return shape.index > page.index || shape.parentId !== page.parentId
}

/** Rough shape of a Pencil mark: a line (strike/underline), circle, tick, or writing. */
export function classifyMark(editor: Editor, shape: TLShape): 'line' | 'circle' | 'tick' | 'writing' | null {
	if (shape.type !== 'draw' && shape.type !== 'highlight') return null
	const segments = (shape as TLDrawShape).props.segments ?? []
	const pts: { x: number; y: number }[] = []
	for (const seg of segments) {
		try {
			pts.push(...b64Vecs.decodePoints(seg.path, (seg as { dim?: 2 | 3 }).dim))
		} catch {
			// unreadable segment
		}
	}
	const b = editor.getShapePageBounds(shape)
	if (!b || pts.length < 2) return 'writing'
	const first = pts[0]
	const last = pts[pts.length - 1]
	const diag = Math.hypot(b.w, b.h)
	if (b.h < 18 && b.w > 2.5 * b.h) return 'line'
	if (Math.hypot(last.x - first.x, last.y - first.y) < 0.25 * diag && b.w > 24 && b.h > 14) return 'circle'
	// A tick: goes down then up, ending higher than it started, small.
	let low = 0
	for (let i = 1; i < pts.length; i++) if (pts[i].y > pts[low].y) low = i
	if (diag < 90 && low > 0 && low < pts.length - 1 && last.y < first.y && last.x > pts[low].x && pts[low].x >= first.x - 4) return 'tick'
	return 'writing'
}
