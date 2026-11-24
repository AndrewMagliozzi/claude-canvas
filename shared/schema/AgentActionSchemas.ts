import z from 'zod'
import { FocusedColor } from '../format/FocusedColor'
import { FocusedFillSchema } from '../format/FocusedFill'
import { FocusedShapeSchema, FocusedTextAnchorSchema } from '../format/FocusedShape'
import { SimpleShapeIdSchema, TodoIdSchema } from '../types/ids-schema'

/**
 * `_systemPromptCategory` is used for system prompt generation
 * but is stripped from the JSON schema sent to the model.
 *
 * See `SystemPromptCategory.ts` for available values.
 */

// Add Detail Action
export const AddDetailAction = z
	.object({
		_type: z.literal('add-detail'),
		intent: z.string(),
	})
	.meta({
		title: 'Add Detail',
		description: 'The AI plans further work so that it can add detail to its work.',
	})

export type AddDetailAction = z.infer<typeof AddDetailAction>

// Align Action
export const AlignAction = z
	.object({
		_type: z.literal('align'),
		alignment: z.enum(['top', 'bottom', 'left', 'right', 'center-horizontal', 'center-vertical']),
		gap: z.number(),
		intent: z.string(),
		shapeIds: z.array(SimpleShapeIdSchema),
	})
	.meta({
		title: 'Align',
		description: 'The AI aligns shapes to each other on an axis.',
		_systemPromptCategory: 'edit',
	})

export type AlignAction = z.infer<typeof AlignAction>

// Bring to Front Action
export const BringToFrontAction = z
	.object({
		_type: z.literal('bringToFront'),
		intent: z.string(),
		shapeIds: z.array(SimpleShapeIdSchema),
	})
	.meta({
		title: 'Bring to Front',
		description:
			'The AI brings one or more shapes to the front so that they appear in front of everything else.',
		_systemPromptCategory: 'edit',
	})

export type BringToFrontAction = z.infer<typeof BringToFrontAction>

// Clear Action
export const ClearAction = z
	.object({
		_type: z.literal('clear'),
	})
	.meta({
		title: 'Clear',
		description: 'The agent deletes all shapes on the canvas.',
	})

export type ClearAction = z.infer<typeof ClearAction>

// Count Shapes Action
export const CountShapesAction = z
	.object({
		_type: z.literal('count'),
		expression: z.string(),
	})
	.meta({
		title: 'Count',
		description:
			'The AI requests to count the number of shapes in the canvas. The answer will be provided to the AI in a follow-up request.',
	})

export type CountShapesAction = z.infer<typeof CountShapesAction>

// Country Info Action
export const CountryInfoAction = z
	.object({
		_type: z.literal('countryInfo'),
		code: z.string(),
	})
	.meta({
		title: 'Country info',
		description:
			'The AI gets information about a country by providing its country code, eg: "de" for Germany.',
	})

export type CountryInfoAction = z.infer<typeof CountryInfoAction>

// Create Action
export const CreateAction = z
	.object({
		_type: z.literal('create'),
		intent: z.string(),
		shape: FocusedShapeSchema,
	})
	.meta({ title: 'Create', description: 'The AI creates a new shape.' })

export type CreateAction = z.infer<typeof CreateAction>

// Delete Action
export const DeleteAction = z
	.object({
		_type: z.literal('delete'),
		intent: z.string(),
		shapeId: SimpleShapeIdSchema,
	})
	.meta({ title: 'Delete', description: 'The AI deletes a shape.', _systemPromptCategory: 'edit' })

export type DeleteAction = z.infer<typeof DeleteAction>

// Distribute Action
export const DistributeAction = z
	.object({
		_type: z.literal('distribute'),
		direction: z.enum(['horizontal', 'vertical']),
		intent: z.string(),
		shapeIds: z.array(SimpleShapeIdSchema),
	})
	.meta({
		title: 'Distribute',
		description: 'The AI distributes shapes horizontally or vertically.',
		_systemPromptCategory: 'edit',
	})

export type DistributeAction = z.infer<typeof DistributeAction>

// Label Action
export const LabelAction = z
	.object({
		_type: z.literal('label'),
		intent: z.string(),
		shapeId: SimpleShapeIdSchema,
		text: z.string(),
	})
	.meta({
		title: 'Label',
		description: "The AI changes a shape's text.",
		_systemPromptCategory: 'edit',
	})

export type LabelAction = z.infer<typeof LabelAction>

// Message Action
export const MessageAction = z
	.object({
		_type: z.literal('message'),
		text: z.string(),
	})
	.meta({ title: 'Message', description: 'The AI sends a message to the user.' })

export type MessageAction = z.infer<typeof MessageAction>

// Move Action
export const MoveAction = z
	.object({
		_type: z.literal('move'),
		intent: z.string(),
		anchor: FocusedTextAnchorSchema,
		shapeId: SimpleShapeIdSchema,
		x: z.number(),
		y: z.number(),
	})
	.meta({
		title: 'Move',
		description: 'The agent moves a shape to a new position.',
		_systemPromptCategory: 'edit',
	})

export type MoveAction = z.infer<typeof MoveAction>

// Pen Action
export const PenAction = z
	.object({
		_type: z.literal('pen'),
		shapeId: SimpleShapeIdSchema,
		color: FocusedColor,
		closed: z.boolean(),
		fill: FocusedFillSchema,
		intent: z.string(),
		points: z.array(
			z.object({
				x: z.number(),
				y: z.number(),
			})
		),
		style: z.enum(['smooth', 'straight']),
	})
	.meta({
		title: 'Pen',
		description:
			'The AI draws a freeform line with a pen. This is useful for drawing custom paths that are not available with the other available shapes. The "smooth" style will automatically smooth the line between points. The "straight" style will render a straight line between points. The "closed" property will determine if the drawn line gets automatically closed to form a complete shape or not. Remember that the pen will be *down* until the action is over. If you want to lift up the pen, start a new pen action.',
	})

export type PenAction = z.infer<typeof PenAction>

// Place Action
export const PlaceAction = z
	.object({
		_type: z.literal('place'),
		align: z.enum(['start', 'center', 'end']),
		alignOffset: z.number(),
		intent: z.string(),
		referenceShapeId: SimpleShapeIdSchema,
		side: z.enum(['top', 'bottom', 'left', 'right']),
		sideOffset: z.number(),
		shapeId: SimpleShapeIdSchema,
	})
	.meta({
		title: 'Place',
		description: 'The AI places a shape relative to another shape.',
		_systemPromptCategory: 'edit',
	})

export type PlaceAction = z.infer<typeof PlaceAction>

// Resize Action
export const ResizeAction = z
	.object({
		_type: z.literal('resize'),
		intent: z.string(),
		originX: z.number(),
		originY: z.number(),
		scaleX: z.number(),
		scaleY: z.number(),
		shapeIds: z.array(SimpleShapeIdSchema),
	})
	.meta({
		title: 'Resize',
		description:
			'The AI resizes one or more shapes, with the resize operation being performed relative to an origin point.',
		_systemPromptCategory: 'edit',
	})

export type ResizeAction = z.infer<typeof ResizeAction>

// Review Action
export const ReviewAction = z
	.object({
		_type: z.literal('review'),
		intent: z.string(),
		x: z.number(),
		y: z.number(),
		w: z.number(),
		h: z.number(),
	})
	.meta({
		title: 'Review',
		description:
			'The AI schedules further work or a review so that it can look at the results of its work so far and take further action, such as reviewing what it has done or taking further steps that would benefit from seeing the results of its work so far.',
	})

export type ReviewAction = z.infer<typeof ReviewAction>

// Rotate Action
export const RotateAction = z
	.object({
		_type: z.literal('rotate'),
		centerY: z.number(),
		degrees: z.number(),
		intent: z.string(),
		originX: z.number(),
		originY: z.number(),
		shapeIds: z.array(SimpleShapeIdSchema),
	})
	.meta({
		title: 'Rotate',
		description: 'The AI rotates one or more shapes around an origin point.',
		_systemPromptCategory: 'edit',
	})

export type RotateAction = z.infer<typeof RotateAction>

// Send to Back Action
export const SendToBackAction = z
	.object({
		_type: z.literal('sendToBack'),
		intent: z.string(),
		shapeIds: z.array(SimpleShapeIdSchema),
	})
	.meta({
		title: 'Send to Back',
		description:
			'The AI sends one or more shapes to the back so that they appear behind everything else.',
		_systemPromptCategory: 'edit',
	})

export type SendToBackAction = z.infer<typeof SendToBackAction>

// Set My View Action
export const SetMyViewAction = z
	.object({
		_type: z.literal('setMyView'),
		intent: z.string(),
		x: z.number(),
		y: z.number(),
		w: z.number(),
		h: z.number(),
	})
	.meta({
		title: 'Set My View',
		description:
			'The AI changes the bounds of its own viewport to navigate to other areas of the canvas if needed. `x` and `y` are the top-left corner of the area you want to see, and `w` and `h` are its width and height. To center your view on a point, set `x` and `y` to that point minus half the width and height.',
	})

export type SetMyViewAction = z.infer<typeof SetMyViewAction>

// Stack Action
export const StackAction = z
	.object({
		_type: z.literal('stack'),
		direction: z.enum(['vertical', 'horizontal']),
		gap: z.number(),
		intent: z.string(),
		shapeIds: z.array(SimpleShapeIdSchema),
	})
	.meta({
		title: 'Stack',
		description:
			"The AI stacks shapes horizontally or vertically. Note that this doesn't align shapes, it only stacks them along one axis.",
		_systemPromptCategory: 'edit',
	})

export type StackAction = z.infer<typeof StackAction>

// Think Action
export const ThinkAction = z
	.object({
		_type: z.literal('think'),
		text: z.string(),
	})
	.meta({ title: 'Think', description: 'The AI describes its intent or reasoning.' })

export type ThinkAction = z.infer<typeof ThinkAction>

// Todo List Action
export const UpsertPersonalTodoItemAction = z
	.object({
		_type: z.literal('update-todo-list'),
		id: TodoIdSchema,
		status: z.enum(['todo', 'in-progress', 'done']),
		text: z.string().optional(),
	})
	.meta({
		title: 'Update Todo List',
		description: 'The AI updates a current todo list item or creates a new one',
	})

export type UpsertPersonalTodoItemAction = z.infer<typeof UpsertPersonalTodoItemAction>

// Update Action
export const UpdateAction = z
	.object({
		_type: z.literal('update'),
		intent: z.string(),
		update: FocusedShapeSchema,
	})
	.meta({
		title: 'Update',
		description: 'The AI updates an existing shape.',
		_systemPromptCategory: 'edit',
	})

export type UpdateAction = z.infer<typeof UpdateAction>
// Unknown Action (catch-all for unrecognized actions)
export const UnknownAction = z
	.object({
		_type: z.literal('unknown'),
	})
	.meta({
		title: 'Unknown',
		description: 'An action with an unknown or unrecognized type.',
	})

export type UnknownAction = z.infer<typeof UnknownAction>

// ============================================================================
// Canvas-conversation actions (added for Claude Canvas)
// ============================================================================

// Page Action: compose a rich HTML page on the canvas
export const PageAction = z
	.object({
		_type: z.literal('page'),
		intent: z.string(),
		shapeId: SimpleShapeIdSchema,
		title: z.string(),
		x: z.number(),
		y: z.number(),
		w: z.number(),
		h: z.number(),
		html: z.string(),
	})
	.meta({
		title: 'Page',
		description:
			'Create a rich page shape (or replace the content of an existing one with the same shapeId) rendered from your HTML, CSS, JavaScript and inline SVG in a sandboxed frame. `x`,`y` is the top-left corner; `w` is the page width in px (the HTML lays out at exactly this width); `h` is your best estimate of its height (it auto-fits the content). Write a complete, self-contained document with inline <style> and <script>. Put `html` LAST in the object. Follow the page guide.',
		_systemPromptCategory: 'edit',
	})

export type PageAction = z.infer<typeof PageAction>

// Camera Action: move the user's view
export const CameraAction = z
	.object({
		_type: z.literal('camera'),
		intent: z.string(),
		shapeIds: z.array(SimpleShapeIdSchema).optional(),
		x: z.number().optional(),
		y: z.number().optional(),
		w: z.number().optional(),
		h: z.number().optional(),
		durationMs: z.number().optional(),
	})
	.meta({
		title: 'Camera',
		description:
			"Move the USER's camera (what they see on their screen). Either give `shapeIds` to frame those shapes, or a region `x`,`y`,`w`,`h` (top-left + size) to fit in view. The move animates over `durationMs` (default 700; 0 = instant) and the next action waits for it, so you can sequence camera moves with drawing to guide attention. Usually end your turn with the camera framing your reply together with what it responds to.",
	})

export type CameraAction = z.infer<typeof CameraAction>

// Pause Action: wait before the next action
export const PauseAction = z
	.object({
		_type: z.literal('pause'),
		ms: z.number(),
	})
	.meta({
		title: 'Pause',
		description:
			'Wait `ms` milliseconds (max 3000) before the next action, e.g. to let the user take in one step before the next appears. Use sparingly.',
	})

export type PauseAction = z.infer<typeof PauseAction>

// Point Action: laser pointer
export const PointAction = z
	.object({
		_type: z.literal('point'),
		intent: z.string(),
		points: z.array(z.object({ x: z.number(), y: z.number() })),
	})
	.meta({
		title: 'Point',
		description:
			'Sweep a temporary laser-pointer trail through `points` (canvas coordinates) to point at or circle something. It fades after a moment and leaves no shape behind. A loop of 8–16 points around a target reads as "circling" it.',
	})

export type PointAction = z.infer<typeof PointAction>

// Switch Page Action: create or switch tldraw pages
export const SwitchPageAction = z
	.object({
		_type: z.literal('switchPage'),
		intent: z.string(),
		name: z.string(),
		create: z.boolean(),
	})
	.meta({
		title: 'Switch Page',
		description:
			'Switch the canvas to the tldraw page called `name` (pages are separate canvases, like sheets in a notebook). If `create` is true and no page has that name, a new page is created first. Shapes you create afterwards go on that page. Only do this when a fresh sheet genuinely helps or the user asks.',
	})

export type SwitchPageAction = z.infer<typeof SwitchPageAction>

// Group / Ungroup
export const GroupAction = z
	.object({
		_type: z.literal('group'),
		intent: z.string(),
		shapeIds: z.array(SimpleShapeIdSchema),
		groupId: SimpleShapeIdSchema,
	})
	.meta({
		title: 'Group',
		description: 'Group two or more shapes so they move together. `groupId` is the id for the new group.',
		_systemPromptCategory: 'edit',
	})

export type GroupAction = z.infer<typeof GroupAction>

export const UngroupAction = z
	.object({
		_type: z.literal('ungroup'),
		intent: z.string(),
		shapeIds: z.array(SimpleShapeIdSchema),
	})
	.meta({
		title: 'Ungroup',
		description: 'Ungroup the given group shapes, leaving their children in place.',
		_systemPromptCategory: 'edit',
	})

export type UngroupAction = z.infer<typeof UngroupAction>

// Run Script Action: escape hatch (only offered when ENABLE_SCRIPT_ACTION=1)
export const RunScriptAction = z
	.object({
		_type: z.literal('runScript'),
		intent: z.string(),
		code: z.string(),
	})
	.meta({
		title: 'Run Script',
		description:
			'Escape hatch: run JavaScript in the browser against the tldraw editor, for things no other action covers. The code is the body of an async function with `editor` (the tldraw Editor) and `tldraw` (the tldraw module) in scope; `return` a JSON-serializable value to have it reported to you on your next turn. Coordinates are absolute page coordinates (not offset). Prefer typed actions whenever they can do the job.',
		_systemPromptCategory: 'edit',
	})

export type RunScriptAction = z.infer<typeof RunScriptAction>

// Board Action: a movable board (kanban columns, a 2×2 matrix, a week plan) of cards
export const BoardAction = z
	.object({
		_type: z.literal('board'),
		intent: z.string(),
		boardId: z.string(),
		title: z.string(),
		layout: z.enum(['columns', 'matrix']),
		zones: z.array(z.string()).min(1).max(7),
		cards: z.array(
			z.object({
				id: z.string(),
				title: z.string(),
				detail: z.string().optional(),
				zone: z.string(),
			})
		),
		x: z.number().optional(),
		y: z.number().optional(),
	})
	.meta({
		title: 'Board',
		description:
			'Create or update a movable board: zones laid out as columns (kanban, week plan) or a 2×2 matrix (4 zones: top-left, top-right, bottom-left, bottom-right), holding cards the person can drag between zones. Sending the same boardId again updates it in place: cards are matched by id, new cards are added, and a card the person moved stays where they put it unless you assign it a different zone than last time.',
		_systemPromptCategory: 'edit',
	})

export type BoardAction = z.infer<typeof BoardAction>
