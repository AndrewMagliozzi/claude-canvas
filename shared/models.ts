/**
 * Models selectable in the chat drawer. These are Claude Code model aliases,
 * passed straight to the Agent SDK, which resolves them to the latest model of
 * each family. "default" means "whatever the server's CLAUDE_MODEL says".
 */
export const AGENT_MODEL_DEFINITIONS = {
	default: { name: 'default', label: 'Default model' },
	opus: { name: 'opus', label: 'Claude Opus' },
	sonnet: { name: 'sonnet', label: 'Claude Sonnet' },
	haiku: { name: 'haiku', label: 'Claude Haiku' },
} as const

export type AgentModelName = keyof typeof AGENT_MODEL_DEFINITIONS
export type AgentModelDefinition = (typeof AGENT_MODEL_DEFINITIONS)[AgentModelName]

export const DEFAULT_MODEL_NAME: AgentModelName = 'default'

export function isValidModelName(value: string | undefined): value is AgentModelName {
	return !!value && value in AGENT_MODEL_DEFINITIONS
}

export function getAgentModelDefinition(modelName: AgentModelName): AgentModelDefinition {
	const definition = AGENT_MODEL_DEFINITIONS[modelName]
	if (!definition) throw new Error(`Model ${modelName} not found`)
	return definition
}

/** Resolve the model to pass to Claude Code for a request. */
export function resolveModelForRequest(requested: string | undefined, serverDefault: string): string {
	if (!requested || requested === 'default' || !isValidModelName(requested)) return serverDefault
	return requested
}
