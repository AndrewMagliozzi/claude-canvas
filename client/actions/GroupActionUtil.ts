import { TLShapeId } from 'tldraw'
import { GroupAction, UngroupAction } from '../../shared/schema/AgentActionSchemas'
import { Streaming } from '../../shared/types/Streaming'
import { AgentHelpers } from '../AgentHelpers'
import { AgentActionUtil, registerActionUtil } from './AgentActionUtil'

export const GroupActionUtil = registerActionUtil(
	class GroupActionUtil extends AgentActionUtil<GroupAction> {
		static override type = 'group' as const

		override getInfo(action: Streaming<GroupAction>) {
			return { icon: 'pencil' as const, description: action.intent ?? 'Grouped shapes' }
		}

		override sanitizeAction(action: Streaming<GroupAction>, helpers: AgentHelpers) {
			if (!action.complete) return action
			action.shapeIds = helpers.ensureShapeIdsExist(action.shapeIds ?? [])
			if (action.shapeIds.length < 2) return null
			action.groupId = helpers.ensureShapeIdIsUnique(action.groupId)
			return action
		}

		override applyAction(action: Streaming<GroupAction>) {
			if (!action.complete) return
			this.editor.groupShapes(
				action.shapeIds.map((id) => `shape:${id}` as TLShapeId),
				{ groupId: `shape:${action.groupId}` as TLShapeId, select: false }
			)
		}
	}
)

export const UngroupActionUtil = registerActionUtil(
	class UngroupActionUtil extends AgentActionUtil<UngroupAction> {
		static override type = 'ungroup' as const

		override getInfo(action: Streaming<UngroupAction>) {
			return { icon: 'pencil' as const, description: action.intent ?? 'Ungrouped shapes' }
		}

		override sanitizeAction(action: Streaming<UngroupAction>, helpers: AgentHelpers) {
			if (!action.complete) return action
			action.shapeIds = helpers.ensureShapeIdsExist(action.shapeIds ?? [])
			return action.shapeIds.length ? action : null
		}

		override applyAction(action: Streaming<UngroupAction>) {
			if (!action.complete) return
			this.editor.ungroupShapes(
				action.shapeIds.map((id) => `shape:${id}` as TLShapeId),
				{ select: false }
			)
		}
	}
)
