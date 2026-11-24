import { UserViewportBoundsPart } from '../../shared/schema/PromptPartDefinitions'
import { AgentHelpers } from '../AgentHelpers'
import { getSafePageBounds } from '../state'
import { PromptPartUtil, registerPromptPartUtil } from './PromptPartUtil'

export const UserViewportBoundsPartUtil = registerPromptPartUtil(
	class UserViewportBoundsPartUtil extends PromptPartUtil<UserViewportBoundsPart> {
		static override type = 'userViewportBounds' as const

		override getPart(_request: unknown, helpers: AgentHelpers): UserViewportBoundsPart {
			// The unobstructed part of the person's screen (excludes toolbars and the drawer).
			const userBounds = getSafePageBounds(this.editor)
			const offsetUserBounds = helpers.applyOffsetToBox(userBounds)

			return {
				type: 'userViewportBounds',
				userBounds: helpers.roundBox(offsetUserBounds),
			}
		}
	}
)
