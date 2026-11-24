import { ModePart } from '../../shared/schema/PromptPartDefinitions'
import { AgentRequest } from '../../shared/types/AgentRequest'
import { $serverConfig } from '../api'
import { PromptPartUtil, registerPromptPartUtil } from './PromptPartUtil'

export const ModePartUtil = registerPromptPartUtil(
	class ModePartUtil extends PromptPartUtil<ModePart> {
		static override type = 'mode' as const

		override getPart(_request: AgentRequest): ModePart {
			const modeDefinition = this.agent.mode.getCurrentModeDefinition()

			if (!modeDefinition.active) {
				throw new Error(`Cannot get mode part for inactive mode: ${modeDefinition.type}`)
			}

			return {
				type: 'mode',
				modeType: modeDefinition.type,
				partTypes: modeDefinition.parts,
				// The script escape hatch is only offered when the server enables it.
				actionTypes: modeDefinition.actions.filter(
					(a) => a !== 'runScript' || $serverConfig.get()?.enableScriptAction === true
				),
			}
		}
	}
)
