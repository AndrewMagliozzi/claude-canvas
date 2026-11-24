import * as tldraw from 'tldraw'
import { RunScriptAction } from '../../shared/schema/AgentActionSchemas'
import { Streaming } from '../../shared/types/Streaming'
import { $serverConfig } from '../api'
import { AgentActionUtil, registerActionUtil } from './AgentActionUtil'

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
	...args: string[]
) => (...args: unknown[]) => Promise<unknown>

/**
 * Escape hatch: run Claude-written JavaScript against the editor.
 * Only offered to Claude, and only executed, when the server was started with
 * ENABLE_SCRIPT_ACTION=1. See README → "Script action" for the risks.
 */
export const RunScriptActionUtil = registerActionUtil(
	class RunScriptActionUtil extends AgentActionUtil<RunScriptAction> {
		static override type = 'runScript' as const

		override getInfo(action: Streaming<RunScriptAction>) {
			return {
				icon: 'pencil' as const,
				summary: `Ran a script${action.intent ? `: ${action.intent}` : ''}`,
				description: '```js\n' + (action.code ?? '') + '\n```',
			}
		}

		override getStatusText(action: Streaming<RunScriptAction>) {
			return `Running a script${action.intent ? `: ${action.intent}` : ''}`
		}

		override blocksStream() {
			return true
		}

		override applyAction(action: Streaming<RunScriptAction>) {
			if (!action.complete) return
			if (!$serverConfig.get()?.enableScriptAction) {
				this.agent.addNote('runScript is disabled on this server; the script was not run.')
				return
			}
			const agent = this.agent
			const editor = this.editor
			return (async () => {
				try {
					const fn = new AsyncFunction('editor', 'tldraw', action.code)
					const result = await Promise.race([
						fn(editor, tldraw),
						new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out after 10s')), 10_000)),
					])
					if (result !== undefined) {
						let text: string
						try {
							text = JSON.stringify(result)
						} catch {
							text = String(result)
						}
						agent.addNote(`runScript (${action.intent}) returned: ${text.slice(0, 4000)}`)
					}
				} catch (e: any) {
					agent.addNote(`runScript (${action.intent}) threw: ${e?.message ?? String(e)}`)
				}
			})()
		}
	}
)
