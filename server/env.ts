import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// Local state (passcode, sessions, operating manual). Tests point this at a scratch folder.
export const DATA_DIR = process.env.CANVAS_DATA_DIR ? path.resolve(process.env.CANVAS_DATA_DIR) : path.join(ROOT_DIR, '.data')
export const CERTS_DIR = path.join(ROOT_DIR, 'certs')

// Load .env if present (Node 22 built-in; never overrides variables already set).
const envFile = path.join(ROOT_DIR, '.env')
if (fs.existsSync(envFile)) {
	try {
		process.loadEnvFile(envFile)
	} catch (e) {
		console.warn('Could not parse .env:', e)
	}
}

fs.mkdirSync(DATA_DIR, { recursive: true })

function bool(v: string | undefined) {
	return v === '1' || v?.toLowerCase() === 'true' || v?.toLowerCase() === 'yes'
}

const args = new Set(process.argv.slice(2))

function resolveWorkspaceDir(): string | null {
	const raw = process.env.WORKSPACE_DIR?.trim()
	if (!raw) return null
	const abs = path.resolve(raw.replace(/^~(?=$|\/)/, process.env.HOME ?? '~'))
	if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
		console.warn(`WORKSPACE_DIR=${raw} is not a directory; file tools stay disabled.`)
		return null
	}
	return fs.realpathSync(abs)
}

export const config = {
	isProduction: process.env.NODE_ENV === 'production',
	host: process.env.HOST ?? '0.0.0.0',
	port: Number(process.env.PORT ?? 5173),
	httpsPort: Number(process.env.HTTPS_PORT ?? 5443),
	https: args.has('--https') || bool(process.env.HTTPS),
	rotatePasscode: args.has('--new-passcode'),
	passcodeOverride: process.env.PASSCODE?.trim() || null,

	/** Model alias or id passed to Claude Code (opus | sonnet | haiku | full model id). */
	defaultModel: process.env.CANVAS_MODEL?.trim() || 'opus',
	effort: (process.env.CANVAS_EFFORT?.trim() || 'low') as 'low' | 'medium' | 'high' | 'xhigh' | 'max',

	/** Optional fallback when the Claude Code login is unavailable. */
	apiKey: process.env.ANTHROPIC_API_KEY?.trim() || null,

	/** When set, Claude gets read-only Read/Glob/Grep inside this one folder. */
	workspaceDir: resolveWorkspaceDir(),

	/** Escape hatch: lets Claude run JavaScript against the tldraw editor in the browser. */
	enableScriptAction: bool(process.env.ENABLE_SCRIPT_ACTION),

	/** Transcribe new handwriting for look_at_canvas with Claude on this Mac (HANDWRITING_TRANSCRIPTION=off to disable). */
	transcribeHandwriting: !/^(0|off|false|no)$/i.test(process.env.HANDWRITING_TRANSCRIPTION ?? ''),
	transcribeModel: process.env.CANVAS_TRANSCRIBE_MODEL?.trim() || 'sonnet',

	/** Log prompts and raw model output to the terminal. */
	debug: bool(process.env.DEBUG_CLAUDE),
}
