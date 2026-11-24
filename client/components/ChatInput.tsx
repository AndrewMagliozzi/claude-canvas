import { useRef } from 'react'
import { Editor, useValue } from 'tldraw'
import { AtIcon } from '../../shared/icons/AtIcon'
import { useAgent } from '../agent/TldrawAgentAppProvider'
import { $draft, sendTurn, setDraft } from '../state'
import { ContextItemTag } from './ContextItemTag'
import { MicButton } from './MicButton'
import { SelectionTag } from './SelectionTag'

/**
 * The drawer's text box. Return inserts a newline; only the Send button (or
 * ⌘/Ctrl+Return) ends the turn. Nothing auto-sends.
 */
export function ChatInput() {
	const agent = useAgent()
	const { editor } = agent
	const draft = useValue('draft', () => $draft.get(), [])
	const isGenerating = useValue('isGenerating', () => agent.requests.isGenerating(), [agent])
	const textareaRef = useRef<HTMLTextAreaElement>(null)

	const isContextToolActive = useValue(
		'isContextToolActive',
		() => {
			const tool = editor.getCurrentTool()
			return tool.id === 'target-shape' || tool.id === 'target-area'
		},
		[editor]
	)
	const selectedShapes = useValue('selectedShapes', () => editor.getSelectedShapes(), [editor])
	const contextItems = useValue('contextItems', () => agent.context.getItems(), [agent])

	return (
		<div className="chat-input">
			<form
				onSubmit={(e) => {
					e.preventDefault()
					sendTurn(agent)
				}}
			>
				<div className="prompt-tags">
					<div className={'chat-context-select ' + (isContextToolActive ? 'active' : '')}>
						<div className="chat-context-select-label">
							<AtIcon /> Point at…
						</div>
						<select
							id="chat-context-select"
							value=" "
							onChange={(e) => {
								const action = ADD_CONTEXT_ACTIONS.find((action) => action.name === e.target.value)
								if (action) action.onSelect(editor)
							}}
						>
							{ADD_CONTEXT_ACTIONS.map((action) => (
								<option key={action.name} value={action.name}>
									{action.name}
								</option>
							))}
						</select>
					</div>
					{selectedShapes.length > 0 && <SelectionTag onClick={() => editor.selectNone()} />}
					{contextItems.map((item, i) => (
						<ContextItemTag editor={editor} onClick={() => agent.context.remove(item)} key={'context-item-' + i} item={item} />
					))}
				</div>

				<textarea
					ref={textareaRef}
					name="input"
					autoComplete="off"
					placeholder="Type or dictate, then press Send. Your drawing goes along too."
					value={draft}
					onChange={(e) => setDraft(e.currentTarget.value)}
					onKeyDown={(e) => {
						if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
							e.preventDefault()
							sendTurn(agent)
						}
					}}
				/>
				<span className="chat-actions">
					<div className="chat-actions-left">
						<MicButton />
						{isGenerating && (
							<button type="button" className="chat-stop" onClick={() => agent.cancel()}>
								Stop
							</button>
						)}
					</div>
					<button className="chat-send" type="submit" title="Send (⌘↩)">
						Send
					</button>
				</span>
			</form>
		</div>
	)
}

const ADD_CONTEXT_ACTIONS = [
	{
		name: 'Pick Shapes',
		onSelect: (editor: Editor) => {
			editor.setCurrentTool('target-shape')
			editor.focus()
		},
	},
	{
		name: 'Pick Area',
		onSelect: (editor: Editor) => {
			editor.setCurrentTool('target-area')
			editor.focus()
		},
	},
	{
		name: ' ',
		onSelect: (editor: Editor) => {
			const currentTool = editor.getCurrentTool()
			if (currentTool.id === 'target-area' || currentTool.id === 'target-shape') {
				editor.setCurrentTool('select')
			}
		},
	},
]
