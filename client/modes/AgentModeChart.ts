import type { AgentRequest } from '../../shared/types/AgentRequest'
import type { TldrawAgent } from '../agent/TldrawAgent'
import type { AgentModeDefinition, AgentModeType } from './AgentModeDefinitions'

/**
 * Lifecycle hooks for an agent mode.
 * Each mode can optionally implement these hooks to respond to state changes.
 */
export interface AgentModeNode {
	onEnter?(agent: TldrawAgent, fromMode: AgentModeType): void
	onExit?(agent: TldrawAgent, toMode: AgentModeType): void
	onPromptStart?(agent: TldrawAgent, request: AgentRequest): void
	onPromptEnd?(agent: TldrawAgent, request: AgentRequest): void
	onPromptCancel?(agent: TldrawAgent, request: AgentRequest): void
}

/**
 * Lifecycle implementations for each agent mode.
 *
 * This chart maps mode types to their lifecycle hooks.
 * Modes can implement any subset of hooks (all are optional).
 * Not all modes need an entry - modes without entries simply have no lifecycle behavior.
 *
 * To add lifecycle behavior for a new mode:
 * 1. Add the mode to AGENT_MODE_DEFINITIONS in AgentModeDefinitions.ts
 * 2. Add an entry here with the lifecycle hooks you need
 */
const _AGENT_MODE_CHART: Record<AgentModeDefinition['type'], AgentModeNode> = {
	idling: {
		onPromptStart(agent) {
			agent.mode.setMode('working')
		},
		onEnter(agent, _fromMode) {
			agent.todos.reset()
			// Claude Canvas: don't clear the user's change history here. It must
			// accumulate between turns (it's what Claude sees as "what changed since
			// your last turn") and is cleared when the next request is built.
		},
	},
	working: {
		onEnter(agent, fromMode) {
			// Reset state when entering working mode
			agent.todos.reset()
			// agent.userAction.clearHistory()
			agent.context.clear()

			// When entering working mode from idling, clear created shapes tracking
			// This handles the case where a user prompt starts while in idling mode,
			// which transitions to working before working.onPromptStart is called
			if (fromMode === 'idling') {
				agent.lints.clearCreatedShapes()
			}
		},

		onExit(agent, _toMode) {
			// Unlock all shapes created during the prompt when exiting working mode
			agent.lints.unlockCreatedShapes()
		},

		onPromptStart(agent, request) {
			// Clear created shapes tracking and flush todos when a new user prompt starts
			// This handles cases where a prompt starts while already in working mode (e.g., continuation, interrupt)
			if (request.source === 'user') {
				agent.todos.flush()
				agent.lints.clearCreatedShapes()
			}
		},

		onPromptEnd(agent, _request) {
			// Check if there are incomplete todos
			const todoList = agent.todos.getTodos()
			const incompleteTodos = todoList.filter((item) => item.status !== 'done')

			if (incompleteTodos.length > 0) {
				// Schedule continuation to complete remaining work
				agent.schedule(
					"Continue until all your todo items are marked as done. If you've completed the work, mark them as done, otherwise keep going."
				)
				return
			}

			// Claude Canvas: no automatic lint follow-up round trip. The turn ends when
			// Claude's reply ends; any lints are included in the next real turn instead.

			// All work complete - return to idling
			agent.mode.setMode('idling')
		},

		onPromptCancel(agent, _request) {
			// Return to idling on cancel
			agent.mode.setMode('idling')
		},
	},
}

/**
 * Get the lifecycle node for a mode, if one exists.
 * This function helps TypeScript resolve types correctly with circular imports.
 */
export function getModeNode(mode: AgentModeType): AgentModeNode {
	return _AGENT_MODE_CHART[mode]
}
