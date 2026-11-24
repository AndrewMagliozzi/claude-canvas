import { PointAction } from '../../shared/schema/AgentActionSchemas'
import { Streaming } from '../../shared/types/Streaming'
import { AgentHelpers } from '../AgentHelpers'
import { AgentActionUtil, registerActionUtil } from './AgentActionUtil'

/** A laser-pointer sweep: points at things without leaving a shape behind. */
export const PointActionUtil = registerActionUtil(
	class PointActionUtil extends AgentActionUtil<PointAction> {
		static override type = 'point' as const

		override getInfo(action: Streaming<PointAction>) {
			return { icon: 'target' as const, description: `**Pointed**${action.intent ? `: ${action.intent}` : ''}` }
		}

		override blocksStream() {
			return true
		}

		override applyAction(action: Streaming<PointAction>, helpers: AgentHelpers) {
			if (!action.complete) return
			const points = (action.points ?? [])
				.map((p) => helpers.ensureValueIsVec(p))
				.filter((p): p is { x: number; y: number } => !!p)
				.map((p) => helpers.removeOffsetFromVec(p))
			if (points.length === 0) return

			const { scribbles } = this.editor
			const sessionId = scribbles.startSession({
				selfConsume: false,
				idleTimeoutMs: 900,
				fadeMode: 'grouped',
				fadeEasing: 'ease-in',
			})
			const scribble = scribbles.addScribbleToSession(sessionId, {
				color: 'laser',
				opacity: 0.8,
				size: 6,
				taper: false,
			})

			// Interpolate so the trail sweeps smoothly over ~700ms.
			const dense: { x: number; y: number }[] = []
			for (let i = 0; i < points.length; i++) {
				const a = points[i]
				const b = points[i + 1]
				dense.push(a)
				if (!b) continue
				const steps = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / 12))
				for (let s = 1; s < steps; s++) {
					dense.push({ x: a.x + ((b.x - a.x) * s) / steps, y: a.y + ((b.y - a.y) * s) / steps })
				}
			}
			const perPoint = Math.max(4, Math.min(30, 700 / dense.length))

			return new Promise<void>((resolve) => {
				let i = 0
				const tick = () => {
					if (!scribbles.isSessionActive(sessionId)) return resolve()
					const p = dense[i++]
					if (!p) {
						scribbles.complete(scribble.id)
						setTimeout(resolve, 250)
						return
					}
					scribbles.addPointToSession(sessionId, scribble.id, p.x, p.y)
					scribbles.extendSession(sessionId)
					setTimeout(tick, perPoint)
				}
				tick()
			})
		}
	}
)
