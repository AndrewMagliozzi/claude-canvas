import fs from 'node:fs'
import path from 'node:path'
import { buildResponseSchema } from '../../shared/schema/buildResponseSchema'
import { CANVAS_KIT_REFERENCE } from '../../shared/canvasKit'
import { config, ROOT_DIR } from '../env'
import type { ModePart } from '../../shared/schema/PromptPartDefinitions'
import { AgentPrompt } from '../../shared/types/AgentPrompt'
import { getSystemPromptFlags } from './getSystemPromptFlags'
import { buildIntroPromptSection } from './sections/intro-section'
import { buildRulesPromptSection } from './sections/rules-section'

/**
 * Build the system prompt for the agent.
 *
 * This is the main instruction set that tells the AI how to behave.
 * The prompt is constructed from modular sections that adapt based on
 * what actions and parts are available.
 *
 * @param prompt - The prompt containing all parts including the mode part.
 * @param opts - Options for building the system prompt.
 * @param opts.withSchema - Whether to include the JSON schema in the system prompt. Defaults to true.
 * @returns The system prompt string.
 */
export function buildSystemPrompt(
	prompt: AgentPrompt,
	opts: { withSchema: boolean } = { withSchema: true }
): string {
	const { withSchema = true } = opts

	const modePart = prompt.mode
	if (!modePart) {
		throw new Error('A mode part is always required.')
	}

	// Defense in depth: never offer the script escape hatch unless the server enables it.
	const actionTypes = modePart.actionTypes.filter((a) => a !== 'runScript' || config.enableScriptAction)
	const safeModePart = { ...modePart, actionTypes }
	const flags = getSystemPromptFlags(actionTypes, modePart.partTypes)

	const lines = [
		buildIntroPromptSection(flags),
		buildRulesPromptSection(flags),
		buildCanvasActionsSection(actionTypes),
		buildPageGuideSection(),
	]
	if (config.workspaceDir) {
		lines.push(`## Files

You have read-only Read, Glob and Grep tools for one folder on the person's Mac: ${config.workspaceDir}. Use them only when the person's request needs those files. Use the tools first; after your last tool call, output the JSON actions as usual.
`)
	}

	if (withSchema) {
		lines.push(buildSchemaPromptSection(safeModePart))
	}

	const result = normalizeNewlines(lines.join('\n'))

	return result
}

function buildSchemaPromptSection(modePart: ModePart) {
	const schema = buildResponseSchema(modePart.actionTypes, modePart.modeType)

	return `## JSON schema

This is the JSON schema for the events you can return. You must conform to this schema. You must only return things in this format, otherwise your response will error. Output exactly ONE JSON object per turn. If you notice a mistake partway through, don't restart or restate the object; keep going and fix it with later actions in the same list. Output ONLY the JSON itself — do not add any preamble, explanation, or commentary before or after it, and do NOT wrap your response in a markdown code block (e.g. \`\`\`json). Just the raw JSON object.

${JSON.stringify(schema, null, 2)}
`
}

function buildCanvasActionsSection(actionTypes: string[]) {
	const has = (t: string) => actionTypes.includes(t)
	return `## Canvas conversation actions

${has('page') ? `- \`page\` composes a rich page (HTML/CSS/JS/SVG) as a shape on the canvas. The page guide below says when and how. The person can draw on top of it; next turn you'll get their marks in page-local coordinates with the page text under each mark. To revise a page, send \`page\` again with the same shapeId. To move or resize it, use \`move\` or \`resize\`.` : ''}
${has('camera') ? `- \`camera\` moves the PERSON's view. The next action waits for it to finish. Use it to lead their eye: show where you're about to write, then frame the finished reply. End most turns with a camera move that frames your reply.` : ''}
${has('point') ? '- `point` sweeps a fading laser trail, for "look here" moments. It leaves nothing behind.' : ''}
${has('pause') ? '- `pause` waits briefly between steps. Only use it when the timing is part of the meaning (e.g. revealing steps one by one).' : ''}
${has('switchPage') ? '- `switchPage` changes or creates a tldraw page (a separate sheet). Rarely needed.' : ''}
${has('setMyView') ? '- `setMyView` moves only YOUR viewport and costs an extra round trip. Use it only when you need to look at a part of the canvas you cannot see. It does not move the person\'s view; use `camera` for that.' : ''}
${has('review') ? '- `review` costs an extra round trip. Use it only after complex diagrams where overlaps are likely. Never use it for pages or simple notes.' : ''}
${has('runScript') ? '- `runScript` is an escape hatch that runs JavaScript against the tldraw editor in the browser. Use it only when no typed action can do the job.' : ''}
- Shapes you created carry your notes. Shapes the person made by hand are listed in the [TURN] line.
- Typical turn: (optional \`think\`) → create the reply (shapes, pen strokes, notes, or a \`page\`) → \`camera\` to frame it → (optional one-line \`message\`).
`
}

let cachedGuide: { mtime: number; text: string } | null = null

/** PAGE_GUIDE.md is re-read whenever it changes, so edits apply on the next new session. */
function buildPageGuideSection() {
	const file = path.join(ROOT_DIR, 'PAGE_GUIDE.md')
	try {
		const mtime = fs.statSync(file).mtimeMs
		if (!cachedGuide || cachedGuide.mtime !== mtime) {
			cachedGuide = { mtime, text: fs.readFileSync(file, 'utf8') }
		}
		return `## Page guide\n\n${cachedGuide.text.replace(/^# .*\n/, '')}\n\n${CANVAS_KIT_REFERENCE}`
	} catch {
		return ''
	}
}

function normalizeNewlines(text: string): string {
	return text.replace(/\n{3,}/g, '\n\n')
}
