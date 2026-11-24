import { PageRecordType } from 'tldraw'
import { SwitchPageAction } from '../../shared/schema/AgentActionSchemas'
import { Streaming } from '../../shared/types/Streaming'
import { AgentActionUtil, registerActionUtil } from './AgentActionUtil'

export const SwitchPageActionUtil = registerActionUtil(
	class SwitchPageActionUtil extends AgentActionUtil<SwitchPageAction> {
		static override type = 'switchPage' as const

		override getInfo(action: Streaming<SwitchPageAction>) {
			return {
				icon: 'note' as const,
				description: `**Switched to page “${action.name ?? ''}”**${action.intent ? `: ${action.intent}` : ''}`,
			}
		}

		override applyAction(action: Streaming<SwitchPageAction>) {
			if (!action.complete || !action.name) return
			const { editor } = this
			const name = action.name.trim()
			let page = editor.getPages().find((p) => p.name.toLowerCase() === name.toLowerCase())
			if (!page && action.create) {
				const id = PageRecordType.createId()
				editor.createPage({ id, name })
				page = editor.getPage(id)
			}
			if (page) editor.setCurrentPage(page.id)
		}
	}
)
