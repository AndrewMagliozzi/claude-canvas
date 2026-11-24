import { atom, Box, Editor } from 'tldraw'
import type { TldrawAgent } from './agent/TldrawAgent'

function load(key: string, fallback: string) {
	try {
		return localStorage.getItem(key) ?? fallback
	} catch {
		return fallback
	}
}

function save(key: string, value: string) {
	try {
		localStorage.setItem(key, value)
	} catch {
		// ignore
	}
}

/** The text the person is composing (typed or dictated). Sent with the next turn. */
export const $draft = atom<string>('draft', load('claude-canvas:draft', ''))
export function setDraft(value: string) {
	$draft.set(value)
	save('claude-canvas:draft', value)
}

/** Whether the chat drawer is open. */
export const $drawerOpen = atom<boolean>('drawerOpen', load('claude-canvas:drawer', 'closed') === 'open')
export function setDrawerOpen(open: boolean) {
	$drawerOpen.set(open)
	save('claude-canvas:drawer', open ? 'open' : 'closed')
}

export const DRAWER_WIDTH = 380

/**
 * The part of the canvas the person can actually see: the viewport minus the
 * chat drawer when it's open (it overlays the canvas).
 */
export function getVisiblePageBounds(editor: Editor): Box {
	const screen = editor.getViewportScreenBounds()
	const covered = $drawerOpen.get() ? Math.min(DRAWER_WIDTH, screen.w * 0.9) : 0
	const w = Math.max(screen.w - covered, screen.w * 0.3)
	const tl = editor.screenToPage({ x: screen.x, y: screen.y })
	const br = editor.screenToPage({ x: screen.x + w, y: screen.y + screen.h })
	return new Box(tl.x, tl.y, br.x - tl.x, br.y - tl.y)
}

/**
 * The screen area not covered by UI chrome (menus, style panel, toolbar, Send
 * button, open drawer), in screen px relative to the canvas. Camera moves fit
 * replies into this area, and it's what Claude is told the person can see.
 */
export function getSafeScreenRect(editor: Editor) {
	const screen = editor.getViewportScreenBounds()
	const drawer = $drawerOpen.get() ? Math.min(DRAWER_WIDTH, screen.w * 0.9) : 0
	const wide = screen.w - drawer > 900
	const insets = { top: 64, bottom: 100, left: 24, right: drawer + (wide ? 200 : 24) }
	return {
		x: insets.left,
		y: insets.top,
		w: Math.max(200, screen.w - insets.left - insets.right),
		h: Math.max(200, screen.h - insets.top - insets.bottom),
	}
}

export function getSafePageBounds(editor: Editor): Box {
	const r = getSafeScreenRect(editor)
	const screen = editor.getViewportScreenBounds()
	const tl = editor.screenToPage({ x: screen.x + r.x, y: screen.y + r.y })
	const br = editor.screenToPage({ x: screen.x + r.x + r.w, y: screen.y + r.y + r.h })
	return new Box(tl.x, tl.y, br.x - tl.x, br.y - tl.y)
}

/**
 * End the person's turn: send whatever is drafted plus the canvas to Claude.
 * This is the ONLY place a turn starts; nothing auto-sends.
 */
export function sendTurn(agent: TldrawAgent) {
	const text = $draft.get().trim()
	setDraft('')
	agent.editor.complete() // finish any in-progress stroke
	agent.interrupt({
		input: {
			agentMessages: [text],
			userMessages: [text || '✏️ (sent the canvas)'],
			bounds: getVisiblePageBounds(agent.editor),
			source: 'user',
			contextItems: agent.context.getItems(),
		},
	})
}
