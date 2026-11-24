import { useEffect, useState } from 'react'
import { useValue } from 'tldraw'
import { useAgent } from '../agent/TldrawAgentAppProvider'
import { installDuetBridge } from '../duet/bridgeClient'
import { $draft, $drawerOpen, sendTurn, setDrawerOpen } from '../state'

/**
 * Floating controls on the canvas: the Send button (ends your turn), the status
 * line with Stop while Claude works, and the chat drawer toggle.
 */
export function TurnControls() {
	const agent = useAgent()
	const isGenerating = useValue('isGenerating', () => agent.requests.isGenerating(), [agent])
	const status = useValue('status', () => agent.$status.get(), [agent])
	const lastTurn = useValue('lastTurn', () => agent.$lastTurn.get(), [agent])
	const draft = useValue('draft', () => $draft.get(), [])
	const drawerOpen = useValue('drawerOpen', () => $drawerOpen.get(), [])
	useEffect(() => {
		;(window as any).agent = agent // for debugging and the e2e test
	}, [agent])
	// Lets Claude Duet (via the connector) look at and draw on this canvas.
	useEffect(() => installDuetBridge(agent), [agent])
	const elapsed = useElapsed(isGenerating ? (status?.startedAt ?? Date.now()) : null)

	return (
		<div className={`turn-controls ${drawerOpen ? 'drawer-open' : ''}`}>
			{isGenerating ? (
				<div className="status-pill" role="status" aria-live="polite">
					<span className="status-spinner" />
					<span className="status-text">{status?.text ?? 'Working…'}</span>
					<span className="status-elapsed">{elapsed}s</span>
					<button className="stop-button" onClick={() => agent.cancel()}>
						Stop
					</button>
				</div>
			) : lastTurn?.error ? (
				<div className="status-pill error" title={lastTurn.error}>
					<span className="status-text">⚠︎ {lastTurn.error.slice(0, 140)}</span>
				</div>
			) : null}
			<div className="turn-buttons">
				<button
					className="drawer-toggle"
					onClick={() => setDrawerOpen(!drawerOpen)}
					aria-label={drawerOpen ? 'Close chat' : 'Open chat'}
					title={drawerOpen ? 'Close chat' : 'Open chat'}
				>
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
						<path d="M4 5h16v11H9l-5 4z" />
					</svg>
					{draft.trim() && !drawerOpen && <span className="draft-dot" />}
				</button>
				<button className="send-button" onClick={() => sendTurn(agent)} title="End your turn: send the canvas and your message to Claude">
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
						<path d="M5 12h14M13 6l6 6-6 6" />
					</svg>
					<span>Send</span>
				</button>
			</div>
		</div>
	)
}

function useElapsed(since: number | null) {
	const [now, setNow] = useState(Date.now())
	useEffect(() => {
		if (since === null) return
		const t = setInterval(() => setNow(Date.now()), 500)
		return () => clearInterval(t)
	}, [since])
	return since === null ? 0 : Math.max(0, Math.round((now - since) / 1000))
}
