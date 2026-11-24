import { Editor, RecordsDiff, squashRecordDiffs, TLRecord } from 'tldraw'
import {
	convertTldrawIdToSimpleId,
	convertTldrawShapeToFocusedShape,
	convertTldrawShapeToFocusedType,
} from '../../shared/format/convertTldrawShapeToFocusedShape'
import { FocusedShape } from '../../shared/format/FocusedShape'
import { UserActionHistoryPart } from '../../shared/schema/PromptPartDefinitions'
import { AgentRequest } from '../../shared/types/AgentRequest'
import { AgentHelpers } from '../AgentHelpers'
import { PromptPartUtil, registerPromptPartUtil } from './PromptPartUtil'

export const UserActionHistoryPartUtil = registerPromptPartUtil(
	class UserActionHistoryPartUtil extends PromptPartUtil<UserActionHistoryPart> {
		static override type = 'userActionHistory' as const

		override getPart(_request: AgentRequest, helpers: AgentHelpers): UserActionHistoryPart {
			const { editor, agent } = helpers

			// Get the action history and clear it so that we can start tracking changes for the next request
			const diffs = agent.userAction.getHistory()
			agent.userAction.clearHistory()
			// Remembered so they can be restored if the request fails to reach Claude.
			agent.lastTakenUserChanges = diffs

			return summarizeUserChanges(editor, helpers, diffs)
		}
	}
)

/**
 * Summarize recorded user diffs (squashed) as added / removed / updated shapes.
 * Shared by the local Claude's prompt and the Duet connector's look_at_canvas.
 */
export function summarizeUserChanges(
	editor: Editor,
	helpers: AgentHelpers,
	diffs: RecordsDiff<TLRecord>[]
): UserActionHistoryPart {
	const part: UserActionHistoryPart = {
		type: 'userActionHistory',
		added: [],
		removed: [],
		updated: [],
	}

	const squashedDiff = squashRecordDiffs(diffs)
	const { added, updated, removed } = squashedDiff

	// Collect user-added shapes
	for (const shape of Object.values(added)) {
		if (shape.typeName !== 'shape') continue
		part.added.push({
			shapeId: convertTldrawIdToSimpleId(shape.id),
			type: convertTldrawShapeToFocusedType(shape),
		})
	}

	// Collect user-removed shapes
	for (const shape of Object.values(removed)) {
		if (shape.typeName !== 'shape') continue
		const focusedShape = convertTldrawShapeToFocusedShape(editor, shape)
		part.removed.push({
			shapeId: focusedShape.shapeId,
			type: focusedShape._type,
		})
	}

	// Collect user-updated shapes
	for (const [from, to] of Object.values(updated)) {
		if (from.typeName !== 'shape' || to.typeName !== 'shape') continue
		const fromFocusedShape = convertTldrawShapeToFocusedShape(editor, from)
		const toFocusedShape = convertTldrawShapeToFocusedShape(editor, to)

		const changeFocusedShape = getFocusedShapeChange(fromFocusedShape, toFocusedShape)
		if (!changeFocusedShape) continue

		const before = helpers.applyOffsetToShapePartial(changeFocusedShape.from)
		const after = helpers.applyOffsetToShapePartial(changeFocusedShape.to)

		part.updated.push({
			shapeId: toFocusedShape.shapeId,
			type: toFocusedShape._type,
			before: helpers.roundShapePartial(before),
			after: helpers.roundShapePartial(after),
		})
	}

	return part
}

/**
 * Get any changed properties between two focused shapes.
 * @param from - The original shape.
 * @param to - The new shape.
 * @returns The changed properties.
 */
function getFocusedShapeChange<T extends FocusedShape['_type']>(
	from: FocusedShape & { _type: T },
	to: FocusedShape & { _type: T }
) {
	if (from._type !== to._type) {
		return null
	}

	const change: {
		from: Partial<FocusedShape>
		to: Partial<FocusedShape>
	} = {
		from: {},
		to: {},
	}

	for (const key in to) {
		const fromValue = from[key]
		const toValue = to[key]
		if (fromValue === toValue) {
			continue
		}
		;(change.from as any)[key] = fromValue
		;(change.to as any)[key] = toValue
	}
	// Nothing Claude can see changed (e.g. only the lock flag).
	if (Object.keys(change.to).length === 0) return null
	return change
}
