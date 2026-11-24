import { PauseAction } from '../../shared/schema/AgentActionSchemas'
import { Streaming } from '../../shared/types/Streaming'
import { AgentActionUtil, registerActionUtil } from './AgentActionUtil'

export const PauseActionUtil = registerActionUtil(
	class PauseActionUtil extends AgentActionUtil<PauseAction> {
		static override type = 'pause' as const

		override getInfo() {
			return null
		}

		override getStatusText() {
			return null
		}

		override blocksStream() {
			return true
		}

		override applyAction(action: Streaming<PauseAction>) {
			if (!action.complete) return
			const ms = Math.min(Math.max(Number(action.ms) || 0, 0), 3000)
			return new Promise<void>((resolve) => setTimeout(resolve, ms))
		}
	}
)
