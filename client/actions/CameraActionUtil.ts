import { Box, TLShapeId } from 'tldraw'
import { CameraAction } from '../../shared/schema/AgentActionSchemas'
import { Streaming } from '../../shared/types/Streaming'
import { AgentHelpers } from '../AgentHelpers'
import { getSafeScreenRect } from '../state'
import { AgentActionUtil, registerActionUtil } from './AgentActionUtil'

/**
 * Moves the USER's camera (unlike the kit's setMyView, which only moves the
 * agent's own viewport). The stream waits for the animation to finish, so
 * Claude can choreograph moves with drawing.
 */
export const CameraActionUtil = registerActionUtil(
	class CameraActionUtil extends AgentActionUtil<CameraAction> {
		static override type = 'camera' as const

		override getInfo(action: Streaming<CameraAction>) {
			return {
				icon: 'eye' as const,
				description: `**Moved your view**${action.intent ? `: ${action.intent}` : ''}`,
			}
		}

		override getStatusText(action: Streaming<CameraAction>) {
			return action.intent ? `Moving the view: ${action.intent}` : 'Moving the view…'
		}

		override blocksStream() {
			return true
		}

		override applyAction(action: Streaming<CameraAction>, helpers: AgentHelpers) {
			if (!action.complete) return
			const { editor } = this

			let target: Box | null = null
			if (action.shapeIds && action.shapeIds.length > 0) {
				const ids = helpers.ensureShapeIdsExist(action.shapeIds)
				const boxes = ids
					.map((id) => editor.getShapePageBounds(`shape:${id}` as TLShapeId))
					.filter((b): b is Box => !!b)
				if (boxes.length > 0) target = Box.Common(boxes)
			}
			if (!target && [action.x, action.y, action.w, action.h].every((v) => typeof v === 'number')) {
				const b = helpers.removeOffsetFromBox({ x: action.x!, y: action.y!, w: action.w!, h: action.h! })
				if (b.w > 0 && b.h > 0) target = Box.From(b)
			}
			if (!target) return

			const duration = Math.min(Math.max(action.durationMs ?? 700, 0), 3000)
			// Fit the target into the part of the screen not covered by UI chrome.
			const move = () => {
				const safe = getSafeScreenRect(editor)
				const pad = 24
				const z = Math.min(
					Math.max(Math.min((safe.w - pad * 2) / target!.w, (safe.h - pad * 2) / target!.h), 0.2),
					1.5
				)
				const cx = safe.x + safe.w / 2
				const cy = safe.y + safe.h / 2
				editor.setCamera(
					{ x: cx / z - target!.midX, y: cy / z - target!.midY, z },
					{ animation: duration > 0 ? { duration, easing: easeInOutCubic } : undefined }
				)
			}

			// Don't yank the camera out from under a stroke in progress.
			return waitUntilIdle(this.editor).then(
				() =>
					new Promise<void>((resolve) => {
						move()
						setTimeout(resolve, duration + 60)
					})
			)
		}
	}
)

function easeInOutCubic(t: number) {
	return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

/** Resolve once the user isn't mid-gesture (max 4s). */
function waitUntilIdle(editor: import('tldraw').Editor): Promise<void> {
	return new Promise((resolve) => {
		const started = Date.now()
		const check = () => {
			const busy = editor.inputs.getIsPointing() || editor.inputs.getIsPinching()
			if (!busy || Date.now() - started > 4000) resolve()
			else setTimeout(check, 100)
		}
		check()
	})
}
