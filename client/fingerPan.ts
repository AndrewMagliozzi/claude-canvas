import { Editor } from 'tldraw'

/**
 * Pencil draws; fingers pan and zoom; palms are ignored.
 *
 * - tldraw switches into "pen mode" the first time it sees an Apple Pencil and
 *   then ignores touch input for tools. We also switch it on ourselves on the
 *   Pencil's first contact, in case Safari's events don't trigger it.
 * - Safari can hand Pencil strokes to iPadOS (Scribble, text selection) unless
 *   the page claims them, so stylus touches are claimed with a non-passive
 *   touchstart listener (React's own touch listeners are passive).
 * - In pen mode, one finger pans the canvas, but not a resting palm: contacts
 *   that are large, or that happen while/just after the Pencil is down, are ignored.
 */

const PALM_SIZE_PX = 32 // PointerEvent width/height; fingertips are ~10–25px, palms larger
const PEN_GRACE_MS = 700

export function installFingerPan(editor: Editor, container: HTMLElement) {
	let active: { id: number; x: number; y: number } | null = null
	const touches = new Set<number>()
	let penDown = false
	let lastPenAt = 0

	const isPalm = (e: PointerEvent) =>
		e.width > PALM_SIZE_PX || e.height > PALM_SIZE_PX || penDown || Date.now() - lastPenAt < PEN_GRACE_MS

	const onDown = (e: PointerEvent) => {
		if (e.pointerType === 'pen') {
			penDown = true
			lastPenAt = Date.now()
			active = null // a palm-started pan must not continue under the Pencil
			if (!editor.getInstanceState().isPenMode && isCanvasTarget(e.target)) {
				editor.updateInstanceState({ isPenMode: true })
			}
			return
		}
		if (e.pointerType !== 'touch') return
		touches.add(e.pointerId)
		if (!editor.getInstanceState().isPenMode) return
		if (!isCanvasTarget(e.target)) return
		if (isPalm(e)) return
		if (touches.size === 1) {
			active = { id: e.pointerId, x: e.clientX, y: e.clientY }
		} else {
			active = null // a second finger: let tldraw's pinch take over
		}
	}

	const onMove = (e: PointerEvent) => {
		if (e.pointerType === 'pen') {
			lastPenAt = Date.now()
			return
		}
		if (!active || e.pointerId !== active.id) return
		if (touches.size !== 1 || penDown) {
			active = null
			return
		}
		const dx = e.clientX - active.x
		const dy = e.clientY - active.y
		active.x = e.clientX
		active.y = e.clientY
		const cam = editor.getCamera()
		editor.setCamera({ x: cam.x + dx / cam.z, y: cam.y + dy / cam.z, z: cam.z })
	}

	const onUp = (e: PointerEvent) => {
		if (e.pointerType === 'pen') {
			penDown = false
			lastPenAt = Date.now()
			return
		}
		touches.delete(e.pointerId)
		if (active?.id === e.pointerId) active = null
	}

	// Claim Apple Pencil touches so iPadOS (Scribble, selection, scrolling) doesn't take them.
	const onTouchStart = (e: TouchEvent) => {
		const stylus = Array.from(e.changedTouches).some((t) => (t as any).touchType === 'stylus')
		if (stylus && isCanvasTarget(e.target) && e.cancelable) e.preventDefault()
	}

	container.addEventListener('pointerdown', onDown, { capture: true })
	window.addEventListener('pointermove', onMove, { capture: true })
	window.addEventListener('pointerup', onUp, { capture: true })
	window.addEventListener('pointercancel', onUp, { capture: true })
	container.addEventListener('touchstart', onTouchStart, { passive: false, capture: true })
	const removeDebug = installPenDebug(editor)
	return () => {
		container.removeEventListener('pointerdown', onDown, { capture: true })
		window.removeEventListener('pointermove', onMove, { capture: true })
		window.removeEventListener('pointerup', onUp, { capture: true })
		window.removeEventListener('pointercancel', onUp, { capture: true })
		container.removeEventListener('touchstart', onTouchStart, { capture: true })
		removeDebug()
	}
}

function isCanvasTarget(target: EventTarget | null) {
	if (!(target instanceof Element)) return false
	return !!target.closest('.tl-canvas') && !target.closest('.tlui-layout__top, .tlui-toolbar, .tlui-menu-zone')
}

/**
 * Add ?debug=pen to the URL to see what the device actually sends:
 * pointer type, pressure, contact size, touch type, pen mode and cancels.
 */
function installPenDebug(editor: Editor) {
	if (!new URLSearchParams(location.search).has('debug')) return () => {}
	const box = document.createElement('div')
	box.style.cssText =
		'position:fixed;left:8px;bottom:110px;z-index:2000;background:rgba(0,0,0,.82);color:#0f0;font:12px/1.4 ui-monospace,monospace;padding:8px 10px;border-radius:8px;max-width:440px;pointer-events:none;white-space:pre'
	document.body.appendChild(box)
	const lines: string[] = []
	const log = (s: string) => {
		lines.unshift(`${new Date().toLocaleTimeString()} ${s}`)
		lines.length = Math.min(lines.length, 12)
		box.textContent = `pen mode: ${editor.getInstanceState().isPenMode}\n` + lines.join('\n')
	}
	const onPointer = (e: PointerEvent) => {
		if (e.type === 'pointermove' && e.pointerType !== 'pen') return
		if (e.type === 'pointermove' && Math.random() > 0.15) return
		log(`${e.type.replace('pointer', '')} ${e.pointerType} p=${e.pressure.toFixed(2)} ${Math.round(e.width)}×${Math.round(e.height)}`)
	}
	const onTouch = (e: TouchEvent) => {
		const t = e.changedTouches[0] as any
		log(`touch${e.type.replace('touch', '')} ${t?.touchType ?? '?'} r=${Math.round(t?.radiusX ?? 0)} cancelable=${e.cancelable}`)
	}
	const types = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'] as const
	for (const t of types) window.addEventListener(t, onPointer, { capture: true })
	window.addEventListener('touchstart', onTouch, { capture: true })
	window.addEventListener('touchcancel', onTouch, { capture: true })
	log('pen debug on — touch the canvas with the Pencil, a finger and your palm')
	return () => {
		for (const t of types) window.removeEventListener(t, onPointer, { capture: true })
		window.removeEventListener('touchstart', onTouch, { capture: true })
		window.removeEventListener('touchcancel', onTouch, { capture: true })
		box.remove()
	}
}
