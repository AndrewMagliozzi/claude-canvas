import { useCallback, useEffect, useState } from 'react'
import {
	b64Vecs,
	DefaultSizeStyle,
	Editor,
	ErrorBoundary,
	Tldraw,
	TldrawUiToastsProvider,
	TLUiOverrides,
	toRichText,
	useValue,
} from 'tldraw'
import { $serverConfig, fetchServerConfig } from './api'
import { TldrawAgentApp } from './agent/TldrawAgentApp'
import { TldrawAgentAppContextProvider, TldrawAgentAppProvider } from './agent/TldrawAgentAppProvider'
import { AuthGate } from './components/AuthGate'
import { ChatPanel } from './components/ChatPanel'
import { ChatPanelFallback } from './components/ChatPanelFallback'
import { TurnControls } from './components/TurnControls'
import { installFingerPan } from './fingerPan'
import { AgentHighlightOverlayUtil } from './overlays/AgentHighlightOverlayUtil'
import { HtmlPageShapeUtil, installPageAutoHeight } from './shapes/HtmlPageShapeUtil'
import { TargetAreaTool } from './tools/TargetAreaTool'
import { TargetShapeTool } from './tools/TargetShapeTool'

// Customize tldraw's styles to play to the agent's strengths
DefaultSizeStyle.setDefaultValue('s')

const shapeUtils = [HtmlPageShapeUtil]
const tools = [TargetShapeTool, TargetAreaTool]
const overlayUtils = [AgentHighlightOverlayUtil]
const overrides: TLUiOverrides = {
	tools: (editor, tools) => ({
		...tools,
		'target-area': {
			id: 'target-area',
			label: 'Pick Area',
			kbd: 'c',
			icon: 'tool-frame',
			onSelect() {
				editor.setCurrentTool('target-area')
			},
		},
		'target-shape': {
			id: 'target-shape',
			label: 'Pick Shape',
			kbd: 's',
			icon: 'tool-frame',
			onSelect() {
				editor.setCurrentTool('target-shape')
			},
		},
	}),
}

// Optional; the SDK runs without a key in development. Never bypassed.
const licenseKey = __TLDRAW_LICENSE_KEY__ || undefined

function App() {
	const [app, setApp] = useState<TldrawAgentApp | null>(null)
	const [configError, setConfigError] = useState<string | null>(null)
	const cfg = useValue('serverConfig', () => $serverConfig.get(), [])

	useEffect(() => {
		fetchServerConfig().catch((e) => setConfigError(String(e?.message ?? e)))
	}, [])

	const handleUnmount = useCallback(() => setApp(null), [])

	const handleMount = useCallback((editor: Editor) => {
		// Pencil-first: start with the draw tool.
		if (editor.getCurrentToolId() === 'select') editor.setCurrentTool('draw')
		installPageAutoHeight(editor)
		const container = editor.getContainer()
		const cleanup = installFingerPan(editor, container)
		;(window as any).editor = editor // handy for debugging and e2e tests
		;(window as any).__tldraw_b64 = b64Vecs
		;(window as any).__toRichText = toRichText
		return cleanup
	}, [])

	return (
		<TldrawUiToastsProvider>
			<div className="app-container">
				<div className="tldraw-canvas">
					<Tldraw
						persistenceKey="claude-canvas"
						licenseKey={licenseKey}
						shapeUtils={shapeUtils}
						tools={tools}
						overlayUtils={overlayUtils}
						overrides={overrides}
						onMount={handleMount}
					>
						<TldrawAgentAppProvider onMount={setApp} onUnmount={handleUnmount} />
					</Tldraw>
				</div>
				{app && (
					<TldrawAgentAppContextProvider app={app}>
						<TurnControls />
						<ErrorBoundary fallback={ChatPanelFallback}>
							<ChatPanel />
						</ErrorBoundary>
					</TldrawAgentAppContextProvider>
				)}
				{configError && <div className="server-error">Can't reach the server on your Mac: {configError}</div>}
				{cfg && !cfg.authorized && <AuthGate />}
			</div>
		</TldrawUiToastsProvider>
	)
}

export default App
