import { BoxModel, JsonValue } from 'tldraw'
import { BlurryShape } from '../format/BlurryShape'
import { FocusedShape } from '../format/FocusedShape'
import { PeripheralShapeCluster } from '../format/PeripheralShapesCluster'
import { AgentModelName } from '../models'
import type { AgentAction } from '../types/AgentAction'
import { AgentCanvasLint } from '../types/AgentCanvasLint'
import { AgentMessage, AgentMessageContent } from '../types/AgentMessage'
import { AgentRequest } from '../types/AgentRequest'
import { ChatHistoryItem } from '../types/ChatHistoryItem'
import { ContextItem } from '../types/ContextItem'
import { SimpleShapeId } from '../types/ids-schema'
import type { PromptPart, PromptPartDefinition } from '../types/PromptPart'
import { TodoItem } from '../types/TodoItem'

// ============================================================================
// Prompt Part Type Interfaces
// ============================================================================

export interface BlurryShapesPart {
	type: 'blurryShapes'
	shapes: BlurryShape[]
}

export interface CanvasLintsPart {
	type: 'canvasLints'
	lints: AgentCanvasLint[]
}

export interface ChatHistoryPart {
	type: 'chatHistory'
	history: ChatHistoryItem[]
}

export interface ContextItemsPart {
	type: 'contextItems'
	items: ContextItem[]
	requestSource: AgentRequest['source']
}

export interface DataPart {
	type: 'data'
	data: JsonValue[]
}

export interface MessagesPart {
	type: 'messages'
	agentMessages: string[]
	requestSource: AgentRequest['source']
}

export interface ModelNamePart {
	type: 'modelName'
	modelName: AgentModelName
}

export interface PeripheralShapesPart {
	type: 'peripheralShapes'
	clusters: PeripheralShapeCluster[]
}

export interface ScreenshotPart {
	type: 'screenshot'
	screenshot: string
}

export interface SelectedShapesPart {
	type: 'selectedShapes'
	shapeIds: SimpleShapeId[]
}

export interface TimePart {
	type: 'time'
	time: string
}

export interface TodoListPart {
	type: 'todoList'
	items: TodoItem[]
}

export interface UserActionHistoryPart {
	type: 'userActionHistory'
	added: {
		shapeId: string
		type: FocusedShape['_type']
	}[]
	removed: {
		shapeId: string
		type: FocusedShape['_type']
	}[]
	updated: {
		shapeId: string
		type: FocusedShape['_type']
		before: Partial<FocusedShape>
		after: Partial<FocusedShape>
	}[]
}

export interface UserViewportBoundsPart {
	type: 'userViewportBounds'
	userBounds: BoxModel | null
}

export interface AgentViewportBoundsPart {
	type: 'agentViewportBounds'
	agentBounds: BoxModel | null
}

export interface ModePart {
	type: 'mode'
	modeType: string
	partTypes: PromptPart['type'][]
	actionTypes: AgentAction['_type'][]
}

export interface DebugPart {
	type: 'debug'
	logSystemPrompt: boolean
	logMessages: boolean
}

export interface PageMarksPart {
	type: 'pageMarks'
	pages: {
		shapeId: string
		title: string
		/** Marks the user made on top of this page, in page-local px (0,0 = page top-left). */
		marks: {
			shapeId: string
			type: string
			box: BoxModel
			text?: string
			/** Visible text in the page underneath the mark. */
			over: string[]
			/** What kind of mark it is: a line (strike/underline), circle, tick, or writing. */
			kind?: 'line' | 'circle' | 'tick' | 'writing'
			/** The exact words under the mark. */
			words?: string
			/** The choice this mark selects, when it's on a data-cc-option (circle or tick). */
			choice?: { question: string | null; option: string; confirm: boolean }
			/** The page region it's in, e.g. "tray" for the Hand-to-Duet tray. */
			region?: string
		}[]
		scriptErrors: string[]
	}[]
}

export interface CanvasNotesPart {
	type: 'canvasNotes'
	notes: string[]
}

export interface TurnContextPart {
	type: 'turnContext'
	source: 'user' | 'self' | 'other-agent'
	/** Whether the user typed/spoke anything this turn. */
	hasText: boolean
	/** The tldraw page the user is on, and the other pages. */
	currentPage: string
	otherPages: string[]
	/** Shapes on the canvas the user drew by hand vs. shapes you made, in view. */
	userShapeIdsInView: string[]
}

// ============================================================================
// Prompt Part Definitions
// ============================================================================

export const PageMarksPartDefinition: PromptPartDefinition<PageMarksPart> = {
	type: 'pageMarks',
	priority: -39,
	buildContent: ({ pages }) => {
		const lines: string[] = []
		for (const page of pages) {
			if (page.marks.length > 0) {
				lines.push(
					`The user marked up your page "${page.title}" (${page.shapeId}). Mark boxes are in page-local px from the page's top-left; "over" lists the page text under each mark; "choice" is the option a circle or tick selects; region "tray" means they wrote a request in the Hand-to-Duet tray (read it from the screenshot):`,
					JSON.stringify(page.marks)
				)
			}
			if (page.scriptErrors.length > 0) {
				lines.push(`Your page "${page.title}" (${page.shapeId}) reported script errors: ${JSON.stringify(page.scriptErrors)}`)
			}
		}
		return lines
	},
}

export const CanvasNotesPartDefinition: PromptPartDefinition<CanvasNotesPart> = {
	type: 'canvasNotes',
	priority: -38,
	buildContent: ({ notes }) => (notes.length ? ['Notes from the canvas since your last turn:', ...notes.map((n) => `- ${n}`)] : []),
}

export const TurnContextPartDefinition: PromptPartDefinition<TurnContextPart> = {
	type: 'turnContext',
	priority: 1000,
	buildContent: ({ source, hasText, currentPage, otherPages, userShapeIdsInView }) => {
		if (source !== 'user') {
			return [
				'[CONTINUATION] This is a follow-up step you scheduled yourself within the same turn (not a new message from the user). Finish what you started, then stop.',
			]
		}
		const lines = [
			`[TURN] The user pressed Send. Current tldraw page: "${currentPage}"${otherPages.length ? `; other pages: ${otherPages.map((p) => `"${p}"`).join(', ')}` : ''}.`,
		]
		if (userShapeIdsInView.length) lines.push(`Shapes in view that the user made by hand: ${userShapeIdsInView.join(', ')}.`)
		if (!hasText) {
			lines.push(
				'The user did not type or say anything this turn — their message is whatever they drew, wrote or changed on the canvas. Read the screenshot and the changes carefully and respond to that.'
			)
		}
		return lines
	},
}

// BlurryShapes
export const BlurryShapesPartDefinition: PromptPartDefinition<BlurryShapesPart> = {
	type: 'blurryShapes',
	priority: -70,
	buildContent: ({ shapes }) => {
		if (shapes.length === 0) return ['There are no shapes in your view at the moment.']
		return [`These are the shapes you can currently see:`, JSON.stringify(shapes)]
	},
}

// CanvasLints
export const CanvasLintsPartDefinition: PromptPartDefinition<CanvasLintsPart> = {
	type: 'canvasLints',
	priority: -50,
	buildContent({ lints }: CanvasLintsPart) {
		if (!lints || lints.length === 0) {
			return []
		}

		const messages: string[] = []

		// Group lints by type
		const growYLints = lints.filter((l) => l.type === 'growY-on-shape')
		const overlappingTextLints = lints.filter((l) => l.type === 'overlapping-text')
		const friendlessArrowLints = lints.filter((l) => l.type === 'friendless-arrow')

		messages.push(
			"[LINTER]: The following potential visual problems have been detected in the canvas. You should decide if you want to address them. Defer to your view of the canvas to decide if you need to make changes; it's very possible that you don't need to make any changes."
		)

		if (growYLints.length > 0) {
			const shapeIds = growYLints.flatMap((l) => l.shapeIds)
			const lines = [
				'Text overflow: These shapes have text that caused their containers to grow past the size that they were intended to be, potentially breaking out of their container. If you decide to fix: you need to set the height back to what you originally intended after increasing the width.',
				...shapeIds.map((id) => `  - ${id}`),
			]
			messages.push(lines.join('\n'))
		}

		if (overlappingTextLints.length > 0) {
			const lines = [
				'Overlapping text: The shapes in each group have text and overlap each other, which may make text hard to read. If you decide to fix this, you may need to increase the size of any shapes containing the text.',
				...overlappingTextLints.map((lint) => `  - ${lint.shapeIds.join(', ')}`),
			]
			messages.push(lines.join('\n'))
		}

		if (friendlessArrowLints.length > 0) {
			const shapeIds = friendlessArrowLints.flatMap((l) => l.shapeIds)
			const lines = [
				"Unconnected arrows: These arrows aren't fully connected to other shapes.",
				...shapeIds.map((id) => `  - ${id}`),
			]
			messages.push(lines.join('\n'))
		}

		return messages
	},
}

// ChatHistory
const CHAT_HISTORY_PRIORITY = -Infinity // history should appear first in the prompt (low priority)

export const ChatHistoryPartDefinition: PromptPartDefinition<ChatHistoryPart> = {
	type: 'chatHistory',
	priority: CHAT_HISTORY_PRIORITY,
	buildMessages: ({ history }) => {
		if (history.length === 0) return []

		const messages: AgentMessage[] = []

		// If the last message is from the user, skip it
		const lastIndex = history.length - 1
		let end = history.length
		if (end > 0 && history[lastIndex].type === 'prompt') {
			end = lastIndex
		}

		for (let i = 0; i < end; i++) {
			const item = history[i]
			const message = buildHistoryItemMessage(item, CHAT_HISTORY_PRIORITY)
			if (message) messages.push(message)
		}

		return messages
	},
}

function buildHistoryItemMessage(item: ChatHistoryItem, priority: number): AgentMessage | null {
	switch (item.type) {
		case 'prompt': {
			const content: AgentMessageContent[] = []

			if (item.agentFacingMessage.trim() !== '') {
				content.push({
					type: 'text',
					text: item.agentFacingMessage,
				})
			}

			if (item.contextItems.length > 0) {
				for (const contextItem of item.contextItems) {
					switch (contextItem.type) {
						case 'shape': {
							const focusedShape = contextItem.shape
							content.push({
								type: 'text',
								text: `[CONTEXT]: ${JSON.stringify(focusedShape)}`,
							})
							break
						}
						case 'shapes': {
							const focusedShapes = contextItem.shapes
							content.push({
								type: 'text',
								text: `[CONTEXT]: ${JSON.stringify(focusedShapes)}`,
							})
							break
						}
						default: {
							content.push({
								type: 'text',
								text: `[CONTEXT]: ${JSON.stringify(contextItem)}`,
							})
							break
						}
					}
				}
			}

			if (content.length === 0) {
				return null
			}

			const role =
				item.promptSource === 'user' || item.promptSource === 'other-agent' ? 'user' : 'assistant'
			return {
				role,
				content,
				priority,
			}
		}
		case 'continuation': {
			if (item.data.length === 0) {
				return null
			}
			const text = `[DATA RETRIEVED]: ${JSON.stringify(item.data)}`
			return {
				role: 'assistant',
				content: [{ type: 'text', text }],
				priority,
			}
		}
		case 'action': {
			const { action } = item
			let text: string
			switch (action._type) {
				case 'message': {
					text = action.text || '<message data lost>'
					break
				}
				case 'think': {
					text = '[THOUGHT]: ' + (action.text || '<thought data lost>')
					break
				}
				default: {
					const { complete: _complete, time: _time, ...rawAction } = action || {}
					text = '[ACTION]: ' + JSON.stringify(rawAction)
					break
				}
			}
			return {
				role: 'assistant',
				content: [{ type: 'text', text }],
				priority,
			}
		}
	}
}

// ContextItems
export const ContextItemsPartDefinition: PromptPartDefinition<ContextItemsPart> = {
	type: 'contextItems',
	priority: -55, // context items in middle
	buildContent: ({ items, requestSource }) => {
		const messages: string[] = []

		const shapeItems = items.filter((item) => item.type === 'shape')
		const shapesItems = items.filter((item) => item.type === 'shapes')
		const areaItems = items.filter((item) => item.type === 'area')
		const pointItems = items.filter((item) => item.type === 'point')

		// Handle area context items
		if (areaItems.length > 0) {
			const isSelf = requestSource === 'self'
			const areas = areaItems.map((item) => item.bounds)
			messages.push(
				isSelf
					? 'You have decided to focus your view on the following area. Make sure to focus your task here.'
					: 'The user has specifically brought your attention to the following areas in this request. The user might refer to them as the "area(s)" or perhaps "here" or "there", but either way, it\'s implied that you should focus on these areas in both your reasoning and actions. Make sure to focus your task on these areas:'
			)
			for (const area of areas) {
				messages.push(JSON.stringify(area))
			}
		}

		// Handle point context items
		if (pointItems.length > 0) {
			const points = pointItems.map((item) => item.point)
			messages.push(
				'The user has specifically brought your attention to the following points in this request. The user might refer to them as the "point(s)" or perhaps "here" or "there", but either way, it\'s implied that you should focus on these points in both your reasoning and actions. Make sure to focus your task on these points:'
			)
			for (const point of points) {
				messages.push(JSON.stringify(point))
			}
		}

		// Handle individual shape context items
		if (shapeItems.length > 0) {
			const shapes = shapeItems.map((item) => item.shape)
			messages.push(
				`The user has specifically brought your attention to these ${shapes.length} shapes individually in this request. Make sure to focus your task on these shapes where applicable:`
			)
			for (const shape of shapes) {
				messages.push(JSON.stringify(shape))
			}
		}

		// Handle groups of shapes context items
		for (const contextItem of shapesItems) {
			const shapes = contextItem.shapes
			if (shapes.length > 0) {
				messages.push(
					`The user has specifically brought your attention to the following group of ${shapes.length} shapes in this request. Make sure to focus your task on these shapes where applicable:`
				)
				messages.push(shapes.map((shape) => JSON.stringify(shape)).join('\n'))
			}
		}

		return messages
	},
}

// Data
export const DataPartDefinition: PromptPartDefinition<DataPart> = {
	type: 'data',
	priority: 200, // API data should come right before the user message but after most other parts
	buildContent: ({ data }) => {
		if (data.length === 0) return []

		const formattedData = data.map((item) => {
			return `${JSON.stringify(item)}`
		})

		return ["Here's the data you requested:", ...formattedData]
	},
}

// Messages
export const MessagesPartDefinition: PromptPartDefinition<MessagesPart> = {
	type: 'messages',
	priority: Infinity, // user message should be last (highest priority)
	buildContent: ({ agentMessages, requestSource }) => {
		switch (requestSource) {
			// we treat all sources the same for the messages part, but you don't have to!
			case 'user':
			case 'self':
			case 'other-agent':
				return agentMessages
		}
	},
}

// ModelName
export const ModelNamePartDefinition: PromptPartDefinition<ModelNamePart> = {
	type: 'modelName',
	getModelName: (part) => {
		return part.modelName
	},
}

// PeripheralShapes
export const PeripheralShapesPartDefinition: PromptPartDefinition<PeripheralShapesPart> = {
	type: 'peripheralShapes',
	priority: -65, // peripheral content after viewport shapes
	buildContent: ({ clusters }) => {
		if (clusters.length === 0) {
			return []
		}

		return [
			"There are some groups of shapes in your peripheral vision, outside the your main view. You can't make out their details or content. If you want to see their content, you need to get closer. The groups are as follows",
			JSON.stringify(clusters),
		]
	},
}

// Screenshot
export const ScreenshotPartDefinition: PromptPartDefinition<ScreenshotPart> = {
	type: 'screenshot',
	priority: -40, // screenshot after text content
	buildContent: ({ screenshot }) => {
		if (screenshot === '') return []

		return [
			'Here is the part of the canvas that you can currently see at this moment. It is not a reference image.',
			screenshot,
		]
	},
}

export const SelectedShapesPartDefinition: PromptPartDefinition<SelectedShapesPart> = {
	type: 'selectedShapes',
	priority: -55,
	buildContent({ shapeIds }: SelectedShapesPart) {
		if (!shapeIds || shapeIds.length === 0) {
			return []
		}

		if (shapeIds.length === 1) {
			return [`The user has this shape selected: ${shapeIds[0]}`]
		}

		return [`The user has these shapes selected: ${shapeIds.join(', ')}`]
	},
}

// Time
export const TimePartDefinition: PromptPartDefinition<TimePart> = {
	type: 'time',
	priority: -100,
	buildContent({ time }: TimePart) {
		return [`The user's current time is: ${time}`]
	},
}

// TodoList
export const TodoListPartDefinition: PromptPartDefinition<TodoListPart> = {
	type: 'todoList',
	priority: 10,
	buildContent: ({ items }) => {
		if (items.length === 0) return ['You have no todos yet.']
		return [`Here is your current todo list:`, JSON.stringify(items)]
	},
}

// UserActionHistory
export const UserActionHistoryPartDefinition: PromptPartDefinition<UserActionHistoryPart> = {
	type: 'userActionHistory',
	priority: -40,
	buildContent: (part) => {
		const { updated, removed, added } = part
		if (updated.length === 0 && removed.length === 0 && added.length === 0) {
			return []
		}

		return [
			'Since the previous request, the user has made the following changes to the canvas:',
			JSON.stringify(part),
		]
	},
}

// UserViewportBounds
export const UserViewportBoundsPartDefinition: PromptPartDefinition<UserViewportBoundsPart> = {
	type: 'userViewportBounds',
	priority: -80,
	buildContent({ userBounds }: UserViewportBoundsPart) {
		if (!userBounds) {
			return []
		}
		return [
			`The bounds of the part of the canvas that the user can currently see are: ${JSON.stringify(userBounds)}`,
		]
	},
}

// AgentViewportBounds
export const AgentViewportBoundsPartDefinition: PromptPartDefinition<AgentViewportBoundsPart> = {
	type: 'agentViewportBounds',
	priority: -80,
	buildContent({ agentBounds }: AgentViewportBoundsPart) {
		if (!agentBounds) {
			return []
		}
		return [
			`The bounds of the part of the canvas that you can currently see are: ${JSON.stringify(agentBounds)}`,
		]
	},
}

// Mode - sends mode metadata to worker for prompt construction
export const ModePartDefinition: PromptPartDefinition<ModePart> = {
	type: 'mode',
	// No buildContent - this is metadata for the worker, not prompt content for the model
}

// Debug - sends debug flags to worker for logging
export const DebugPartDefinition: PromptPartDefinition<DebugPart> = {
	type: 'debug',
	// No buildContent - this is metadata for the worker, not prompt content for the model
}
