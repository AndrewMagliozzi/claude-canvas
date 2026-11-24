import { TLShapeId } from 'tldraw'
import { PageAction } from '../../shared/schema/AgentActionSchemas'
import { Streaming } from '../../shared/types/Streaming'
import { AgentHelpers } from '../AgentHelpers'
import { HTML_PAGE_TYPE } from '../shapes/HtmlPageShapeUtil'
import { AgentActionUtil, registerActionUtil } from './AgentActionUtil'

export const PageActionUtil = registerActionUtil(
	class PageActionUtil extends AgentActionUtil<PageAction> {
		static override type = 'page' as const

		override getInfo(action: Streaming<PageAction>) {
			const label = action.complete ? 'Composed a page' : 'Composing a page'
			const title = action.title ? `: ${action.title}` : ''
			return {
				icon: 'note' as const,
				description: `**${label}${title}**${action.intent ? ` — ${action.intent}` : ''}`,
			}
		}

		override getStatusText(action: Streaming<PageAction>) {
			const kb = action.html ? ` (${Math.round(action.html.length / 100) / 10} KB)` : ''
			return action.complete
				? `Placed page${action.title ? ` “${action.title}”` : ''}`
				: `Composing page${action.title ? ` “${action.title}”` : ''}${kb}…`
		}

		override sanitizeAction(action: Streaming<PageAction>, helpers: AgentHelpers) {
			if (!action.shapeId) return action
			// Reuse the id if it's an existing page (replace its content); otherwise make it unique.
			const existing = this.editor.getShape(`shape:${action.shapeId}` as TLShapeId)
			if (!existing || existing.type !== HTML_PAGE_TYPE) {
				action.shapeId = helpers.ensureShapeIdIsUnique(action.shapeId, action.complete)
			}
			return action
		}

		override applyAction(action: Streaming<PageAction>, helpers: AgentHelpers) {
			if (!action.shapeId) return
			const id = `shape:${action.shapeId}` as TLShapeId
			const existing = this.editor.getShape(id)

			const hasBox =
				typeof action.x === 'number' && typeof action.y === 'number' && typeof action.w === 'number'
			const pos = hasBox ? helpers.removeOffsetFromVec({ x: action.x!, y: action.y! }) : null
			const w = clamp(action.w ?? 720, 160, 2400)
			const h = clamp(action.h ?? 480, 60, 8000)

			if (!action.complete) {
				// Show a placeholder where the page will land, but don't touch an existing page yet.
				if (existing || !pos) return
				this.editor.createShape({
					id,
					type: HTML_PAGE_TYPE,
					x: pos.x,
					y: pos.y,
					isLocked: true,
					props: { w, h, html: '', title: action.title ?? '' },
				})
				return
			}

			const html = action.html ?? ''
			if (existing && existing.type === HTML_PAGE_TYPE) {
				this.editor.updateShape({
					id,
					type: HTML_PAGE_TYPE,
					...(pos ? { x: pos.x, y: pos.y } : {}),
					isLocked: false,
					props: { w, h, html, title: action.title ?? existing.props.title },
					meta: { ...existing.meta, autoHeight: true },
				})
				return
			}
			if (!pos) return
			this.editor.createShape({
				id,
				type: HTML_PAGE_TYPE,
				x: pos.x,
				y: pos.y,
				props: { w, h, html, title: action.title ?? '' },
				meta: { autoHeight: true },
			})
		}
	}
)

function clamp(n: number, min: number, max: number) {
	return Math.min(Math.max(Number.isFinite(n) ? n : min, min), max)
}
