import type { AgentAction } from '../../shared/types/AgentAction'
import type { PromptPart } from '../../shared/types/PromptPart'
// Import action utils to ensure they register themselves
import { AlignActionUtil } from '../actions/AlignActionUtil'
import { BoardActionUtil } from '../actions/BoardActionUtil'
import { BringToFrontActionUtil } from '../actions/BringToFrontActionUtil'
import { CameraActionUtil } from '../actions/CameraActionUtil'
import { CreateActionUtil } from '../actions/CreateActionUtil'
import { DeleteActionUtil } from '../actions/DeleteActionUtil'
import { DistributeActionUtil } from '../actions/DistributeActionUtil'
import { GroupActionUtil, UngroupActionUtil } from '../actions/GroupActionUtil'
import { LabelActionUtil } from '../actions/LabelActionUtil'
import { MessageActionUtil } from '../actions/MessageActionUtil'
import { MoveActionUtil } from '../actions/MoveActionUtil'
import { PageActionUtil } from '../actions/PageActionUtil'
import { PauseActionUtil } from '../actions/PauseActionUtil'
import { PenActionUtil } from '../actions/PenActionUtil'
import { PlaceActionUtil } from '../actions/PlaceActionUtil'
import { PointActionUtil } from '../actions/PointActionUtil'
import { ResizeActionUtil } from '../actions/ResizeActionUtil'
import { ReviewActionUtil } from '../actions/ReviewActionUtil'
import { RotateActionUtil } from '../actions/RotateActionUtil'
import { RunScriptActionUtil } from '../actions/RunScriptActionUtil'
import { SendToBackActionUtil } from '../actions/SendToBackActionUtil'
import { SetMyViewActionUtil } from '../actions/SetMyViewActionUtil'
import { StackActionUtil } from '../actions/StackActionUtil'
import { SwitchPageActionUtil } from '../actions/SwitchPageActionUtil'
import { ThinkActionUtil } from '../actions/ThinkActionUtil'
import { UnknownActionUtil } from '../actions/UnknownActionUtil'
import { UpdateActionUtil } from '../actions/UpdateActionUtil'
// Import prompt part utils to ensure they register themselves
import { AgentViewportBoundsPartUtil } from '../parts/AgentViewportBoundsPartUtil'
import { BlurryShapesPartUtil } from '../parts/BlurryShapesPartUtil'
import { CanvasLintsPartUtil } from '../parts/CanvasLintsPartUtil'
import { CanvasNotesPartUtil } from '../parts/CanvasNotesPartUtil'
import { ChatHistoryPartUtil } from '../parts/ChatHistoryPartUtil'
import { ContextItemsPartUtil } from '../parts/ContextItemsPartUtil'
import { DataPartUtil } from '../parts/DataPartUtil'
import { DebugPartUtil } from '../parts/DebugPartUtil'
import { MessagesPartUtil } from '../parts/MessagesPartUtil'
import { ModelNamePartUtil } from '../parts/ModelNamePartUtil'
import { ModePartUtil } from '../parts/ModePartUtil'
import { PageMarksPartUtil } from '../parts/PageMarksPartUtil'
import { PeripheralShapesPartUtil } from '../parts/PeripheralShapesPartUtil'
import { ScreenshotPartUtil } from '../parts/ScreenshotPartUtil'
import { SelectedShapesPartUtil } from '../parts/SelectedShapesPartUtil'
import { TimePartUtil } from '../parts/TimePartUtil'
import { TurnContextPartUtil } from '../parts/TurnContextPartUtil'
import { UserActionHistoryPartUtil } from '../parts/UserActionHistoryPartUtil'
import { UserViewportBoundsPartUtil } from '../parts/UserViewportBoundsPartUtil'

/**
 * What an agent can see and do when in a given mode.
 *
 * This is a discriminated union based on the `active` property:
 * - Active modes can take actions and receive prompt parts
 * - Inactive modes cannot take actions (agent is idle/waiting)
 */
export type AgentModeDefinition = {
	/** A unique identifier for the agent mode. */
	type: string
} & (
	| {
			/** Whether the agent is active in this mode and can take actions. */
			active: true
			/** The prompt parts that determine what information will be sent to the model. */
			parts: PromptPart['type'][]
			/** The actions that the agent can take. */
			actions: AgentAction['_type'][]
	  }
	| {
			/** Whether the agent is active in this mode and can take actions. */
			active: false
	  }
)

/**
 * All agent mode definitions.
 *
 * To add a new mode, add a new object to this array.
 * To change what the agent can see, edit the `parts` array.
 * To change what the agent can do, edit the `actions` array.
 *
 * By importing utils directly, we ensure they are registered when this module is loaded.
 */
export const AGENT_MODE_DEFINITIONS = [
	{
		type: 'idling',
		active: false,
	},
	{
		type: 'working',
		active: true,

		/**
		 * Prompt parts determine what information will be sent to the model.
		 */
		parts: [
			// Mode (sends metadata to the server)
			ModePartUtil.type,

			// Debug (sends debug flags to the server)
			DebugPartUtil.type,

			// Model
			ModelNamePartUtil.type,

			// Request
			MessagesPartUtil.type,
			DataPartUtil.type,
			ContextItemsPartUtil.type,
			TurnContextPartUtil.type,

			// Viewport
			ScreenshotPartUtil.type,
			UserViewportBoundsPartUtil.type,
			AgentViewportBoundsPartUtil.type,

			// Shapes
			BlurryShapesPartUtil.type,
			PeripheralShapesPartUtil.type,
			SelectedShapesPartUtil.type,
			PageMarksPartUtil.type,

			// History (chatHistory is only sent when the Claude session can't be resumed)
			ChatHistoryPartUtil.type,
			UserActionHistoryPartUtil.type,
			CanvasNotesPartUtil.type,

			// Lints
			CanvasLintsPartUtil.type,

			// Metadata
			TimePartUtil.type,
		],

		/**
		 * Agent actions determine what actions the agent can take.
		 */
		actions: [
			// Communication
			MessageActionUtil.type,

			// Planning
			ThinkActionUtil.type,
			ReviewActionUtil.type,
			SetMyViewActionUtil.type,

			// Pages and the user's camera
			PageActionUtil.type,
			BoardActionUtil.type,
			CameraActionUtil.type,
			PointActionUtil.type,
			PauseActionUtil.type,
			SwitchPageActionUtil.type,

			// Individual shapes
			CreateActionUtil.type,
			DeleteActionUtil.type,
			UpdateActionUtil.type,
			LabelActionUtil.type,
			MoveActionUtil.type,

			// Groups of shapes
			GroupActionUtil.type,
			UngroupActionUtil.type,
			PlaceActionUtil.type,
			BringToFrontActionUtil.type,
			SendToBackActionUtil.type,
			RotateActionUtil.type,
			ResizeActionUtil.type,
			AlignActionUtil.type,
			DistributeActionUtil.type,
			StackActionUtil.type,

			// Drawing
			PenActionUtil.type,

			// Escape hatch (filtered out unless ENABLE_SCRIPT_ACTION=1 on the server)
			RunScriptActionUtil.type,

			// Internal (required)
			UnknownActionUtil.type,
		],
	},
] as const satisfies AgentModeDefinition[]

/**
 * An agent mode definition from the AGENT_MODE_DEFINITIONS array.
 */
export type AgentModeDefinitionType = (typeof AGENT_MODE_DEFINITIONS)[number]

/**
 * The type of an agent mode.
 */
export type AgentModeType = AgentModeDefinitionType['type']

/**
 * Get the mode definition for a given mode type.
 * @param type - The mode type to look up.
 * @returns The mode definition.
 */
export function getAgentModeDefinition(type: AgentModeType): AgentModeDefinitionType {
	const mode = AGENT_MODE_DEFINITIONS.find((m) => m.type === type)
	if (!mode) throw new Error(`Unknown agent mode: ${type}`)
	return mode
}
