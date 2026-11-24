import { AgentMessage, AgentMessageContent } from '../../shared/types/AgentMessage'
import { AgentPrompt } from '../../shared/types/AgentPrompt'
import { getPromptPartDefinition, PromptPart } from '../../shared/types/PromptPart'

/** Anthropic Messages API content blocks (the subset we produce). */
export type ContentBlock =
	| { type: 'text'; text: string }
	| {
			type: 'image'
			source: { type: 'base64'; media_type: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'; data: string }
	  }

export interface BuildMessagesOptions {
	/**
	 * Skip the chat history part. We do this whenever the Claude session already
	 * remembers earlier turns, so history isn't sent twice.
	 */
	skipChatHistory: boolean
}

/**
 * Turn the client's prompt parts into a single user turn for Claude.
 *
 * The kit's prompt-part definitions produce a list of role-tagged messages sorted
 * by priority. In a live Claude session, Claude's own earlier replies are already in
 * the transcript, so everything here goes into one user message. When history
 * has to be replayed (fresh session), it is rendered as a labelled transcript.
 */
export function buildUserContent(prompt: AgentPrompt, opts: BuildMessagesOptions): ContentBlock[] {
	const allMessages: AgentMessage[] = []

	for (const part of Object.values(prompt) as PromptPart[]) {
		if (opts.skipChatHistory && part.type === 'chatHistory') continue
		allMessages.push(...buildMessagesFromPart(part))
	}

	// Sort by priority (higher priority = later in prompt)
	allMessages.sort((a, b) => a.priority - b.priority)

	const blocks: ContentBlock[] = []
	let inHistory = false
	for (const message of allMessages) {
		const isHistory = message.priority === -Infinity
		if (isHistory && !inHistory) {
			blocks.push({
				type: 'text',
				text: '<earlier_conversation note="Replayed because the previous session could not be resumed. USER = the person; ASSISTANT = you.">',
			})
			inHistory = true
		}
		if (!isHistory && inHistory) {
			blocks.push({ type: 'text', text: '</earlier_conversation>' })
			inHistory = false
		}
		for (const item of message.content) {
			const block = toContentBlock(item, isHistory ? message.role : null)
			if (block) blocks.push(block)
		}
	}
	if (inHistory) blocks.push({ type: 'text', text: '</earlier_conversation>' })

	return mergeAdjacentText(blocks)
}

function toContentBlock(item: AgentMessageContent, historyRole: string | null): ContentBlock | null {
	if (item.type === 'image' && item.image) {
		return dataUrlToImageBlock(item.image)
	}
	if (item.text === undefined || item.text === '') return null
	const prefix = historyRole ? `${historyRole.toUpperCase()}: ` : ''
	return { type: 'text', text: prefix + item.text }
}

function dataUrlToImageBlock(dataUrl: string): ContentBlock | null {
	const match = /^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/s.exec(dataUrl)
	if (!match) return null
	return {
		type: 'image',
		source: {
			type: 'base64',
			media_type: match[1] as 'image/jpeg',
			data: match[2],
		},
	}
}

function mergeAdjacentText(blocks: ContentBlock[]): ContentBlock[] {
	const out: ContentBlock[] = []
	for (const b of blocks) {
		const last = out[out.length - 1]
		if (b.type === 'text' && last?.type === 'text') {
			last.text += '\n\n' + b.text
		} else {
			out.push(b.type === 'text' ? { ...b } : b)
		}
	}
	return out
}

/**
 * Build messages from a prompt part using its definition.
 */
function buildMessagesFromPart(part: PromptPart): AgentMessage[] {
	const definition = getPromptPartDefinition(part.type)
	if (definition.buildMessages) {
		return definition.buildMessages(part)
	}
	const content = definition.buildContent ? definition.buildContent(part) : []
	if (!content || content.length === 0) return []

	const messageContent: AgentMessageContent[] = content.map((item) =>
		typeof item === 'string' && item.startsWith('data:image/')
			? { type: 'image', image: item }
			: { type: 'text', text: item }
	)
	return [{ role: 'user', content: messageContent, priority: definition.priority ?? 0 }]
}
