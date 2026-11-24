import { CanvasNotesPart } from '../../shared/schema/PromptPartDefinitions'
import { PromptPartUtil, registerPromptPartUtil } from './PromptPartUtil'

export const CanvasNotesPartUtil = registerPromptPartUtil(
	class CanvasNotesPartUtil extends PromptPartUtil<CanvasNotesPart> {
		static override type = 'canvasNotes' as const

		override getPart(): CanvasNotesPart {
			return { type: 'canvasNotes', notes: this.agent.takeNotes() }
		}
	}
)
