import { Box } from 'tldraw'
import { convertTldrawIdToSimpleId } from '../../shared/format/convertTldrawShapeToFocusedShape'
import { TurnContextPart } from '../../shared/schema/PromptPartDefinitions'
import { AgentRequest } from '../../shared/types/AgentRequest'
import { PromptPartUtil, registerPromptPartUtil } from './PromptPartUtil'

export const TurnContextPartUtil = registerPromptPartUtil(
	class TurnContextPartUtil extends PromptPartUtil<TurnContextPart> {
		static override type = 'turnContext' as const

		override getPart(request: AgentRequest): TurnContextPart {
			const { editor } = this
			const current = editor.getCurrentPage()
			const view = Box.From(request.bounds)
			const userShapeIdsInView = editor
				.getCurrentPageShapes()
				.filter((s) => !s.meta?.by && s.type !== 'group')
				.filter((s) => {
					const b = editor.getShapePageBounds(s)
					return !!b && b.collides(view)
				})
				.slice(0, 60)
				.map((s) => convertTldrawIdToSimpleId(s.id))
			return {
				type: 'turnContext',
				source: request.source,
				hasText: request.agentMessages.some((m) => m.trim().length > 0),
				currentPage: current.name,
				otherPages: editor
					.getPages()
					.filter((p) => p.id !== current.id)
					.map((p) => p.name),
				userShapeIdsInView,
			}
		}
	}
)
