import { useCallback } from 'react'
import { useValue } from 'tldraw'
import { AGENT_MODEL_DEFINITIONS, AgentModelName } from '../../shared/models'
import { $serverConfig } from '../api'
import { useAgent } from '../agent/TldrawAgentAppProvider'
import { $drawerOpen, setDrawerOpen } from '../state'
import { ChatHistory } from './chat-history/ChatHistory'
import { ChatInput } from './ChatInput'

/** The slide-out chat drawer: turn history, text box, mic and Send. */
export function ChatPanel() {
	const agent = useAgent()
	const open = useValue('drawerOpen', () => $drawerOpen.get(), [])
	const modelName = useValue('modelName', () => agent.modelName.getModelName(), [agent])
	const cfg = useValue('serverConfig', () => $serverConfig.get(), [])

	const handleNewChat = useCallback(() => {
		if (agent.chat.getHistory().length > 0 && !window.confirm('Start a new conversation? Claude will forget this one (your canvas stays).')) return
		agent.reset()
	}, [agent])

	return (
		<aside className={`chat-drawer chat-panel tl-theme__dark ${open ? 'open' : ''}`} aria-hidden={!open}>
			<div className="chat-header">
				<div className="chat-title">Conversation</div>
				<select
					className="model-select"
					value={modelName}
					onChange={(e) => agent.modelName.setModelName(e.target.value as AgentModelName)}
					title="Model"
				>
					{Object.values(AGENT_MODEL_DEFINITIONS).map((m) => (
						<option key={m.name} value={m.name}>
							{m.name === 'default' && cfg ? `Default (${cfg.defaultModel})` : m.label}
						</option>
					))}
				</select>
				<button className="header-button" onClick={handleNewChat} title="New conversation">
					New
				</button>
				<button className="header-button" onClick={() => setDrawerOpen(false)} aria-label="Close chat">
					✕
				</button>
			</div>
			<ChatHistory agent={agent} />
			<div className="chat-input-container">
				<ChatInput />
				{cfg && (cfg.enableScriptAction || cfg.workspaceEnabled) && (
					<div className="chat-flags">
						{cfg.enableScriptAction && <span>⚠︎ script action on</span>}
						{cfg.workspaceEnabled && <span>📁 read-only file tools on</span>}
					</div>
				)}
			</div>
		</aside>
	)
}
