import { useCallback, useMemo } from 'react'
import {
	BaseBoxShapeUtil,
	Editor,
	HTMLContainer,
	T,
	TLResizeInfo,
	TLShape,
	resizeBox,
	useEditor,
	useIsEditing,
} from 'tldraw'
import {
	buildSrcDoc,
	onPageSize,
	registerPageIframe,
	requestPageSnapshot,
	stripScripts,
	unregisterPageIframe,
} from './pageBridge'

export const HTML_PAGE_TYPE = 'html-page'

declare module 'tldraw' {
	export interface TLGlobalShapePropsMap {
		[HTML_PAGE_TYPE]: { w: number; h: number; html: string; title: string }
	}
}

export type HtmlPageShape = TLShape<typeof HTML_PAGE_TYPE>

/**
 * A "page" Claude composes: arbitrary HTML/CSS/JS/SVG rendered in a sandboxed
 * iframe (scripts allowed, no same-origin access).
 *
 * - The iframe ignores pointer events unless you double-click the page to
 *   interact with it, so Pencil strokes land on the canvas on top of the page.
 * - Pages grow or shrink to fit their content, until you resize one by hand.
 * - Exports and screenshots render a live DOM snapshot from inside the iframe,
 *   so Claude sees the page as it looks now, with your marks drawn over it.
 */
export class HtmlPageShapeUtil extends BaseBoxShapeUtil<HtmlPageShape> {
	static override type = HTML_PAGE_TYPE
	static override props = { w: T.number, h: T.number, html: T.string, title: T.string }

	getDefaultProps(): HtmlPageShape['props'] {
		return { w: 720, h: 480, html: '', title: '' }
	}

	override canEdit() {
		return true
	}

	override canScroll() {
		return true
	}

	override canBind() {
		return true
	}

	override onResize(shape: HtmlPageShape, info: TLResizeInfo<HtmlPageShape>) {
		const resized = resizeBox(shape, info)
		// Once resized by hand, stop auto-fitting the height.
		return { ...resized, meta: { ...shape.meta, autoHeight: false } }
	}

	component(shape: HtmlPageShape) {
		return <HtmlPageComponent shape={shape} />
	}

	getIndicatorPath(shape: HtmlPageShape) {
		const path = new Path2D()
		path.roundRect(0, 0, shape.props.w, shape.props.h, 6)
		return path
	}

	override async toSvg(shape: HtmlPageShape) {
		const { w, h, html } = shape.props
		const live = await requestPageSnapshot(shape.id)
		const source = live ?? stripScripts(html)
		const href = htmlToSvgDataUrl(source, w, h)
		return (
			<g>
				<rect width={w} height={h} rx={6} fill="white" stroke="#d0d0d0" />
				{href && <image href={href} width={w} height={h} />}
			</g>
		)
	}
}

/** Chat-history previews (inside the drawer) render pages statically, without scripts. */
function isMainCanvas(editor: Editor) {
	try {
		return !editor.getContainer().closest('.chat-drawer')
	} catch {
		return true
	}
}

function HtmlPageComponent({ shape }: { shape: HtmlPageShape }) {
	const editor = useEditor()
	const isMain = isMainCanvas(editor)
	const isEditing = useIsEditing(shape.id)
	const { html, title } = shape.props
	const srcDoc = useMemo(() => (html ? (isMain ? buildSrcDoc(html) : stripScripts(html)) : ''), [html, isMain])

	const ref = useCallback(
		(iframe: HTMLIFrameElement | null) => {
			if (!iframe || !isMain) return
			registerPageIframe(shape.id, iframe)
			return () => unregisterPageIframe(shape.id, iframe)
		},
		[shape.id, isMain]
	)

	return (
		<HTMLContainer
			className="html-page-shape"
			style={{
				pointerEvents: isEditing ? 'all' : 'none',
				outline: isEditing ? '2px solid var(--color-selected)' : undefined,
			}}
		>
			{html ? (
				<iframe
					ref={ref}
					title={title || 'Page'}
					srcDoc={srcDoc}
					sandbox={isMain ? 'allow-scripts' : ''}
					referrerPolicy="no-referrer"
					style={{ pointerEvents: isEditing ? 'auto' : 'none' }}
				/>
			) : (
				<div className="html-page-placeholder">
					<div className="html-page-placeholder-title">{title || 'Composing a page…'}</div>
					<div className="html-page-placeholder-bar" />
					<div className="html-page-placeholder-bar short" />
					<div className="html-page-placeholder-bar" />
				</div>
			)}
		</HTMLContainer>
	)
}

/**
 * Render HTML into an isolated SVG image (data URL) so its CSS can't leak into
 * the rest of the export. Content must be XHTML inside <foreignObject>.
 */
function htmlToSvgDataUrl(html: string, w: number, h: number): string | null {
	try {
		const doc = new DOMParser().parseFromString(html, 'text/html')
		doc.querySelectorAll('script, iframe, object, embed, link[rel="preload"]').forEach((el) => el.remove())
		const xhtml = new XMLSerializer().serializeToString(doc.documentElement)
		const svg =
			`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
			`<foreignObject x="0" y="0" width="${w}" height="${h}">${xhtml}</foreignObject></svg>`
		return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
	} catch (e) {
		console.warn('Could not render page for export', e)
		return null
	}
}

/** Keep page heights fitted to their content (unless resized by hand). */
export function installPageAutoHeight(editor: Editor) {
	onPageSize((shapeId, size) => {
		const shape = editor.getShape(shapeId as HtmlPageShape['id'])
		if (!shape || shape.type !== HTML_PAGE_TYPE) return
		if (shape.meta.autoHeight === false) return
		const h = Math.min(Math.max(Math.round(size.h), 60), 8000)
		if (Math.abs(h - shape.props.h) <= 4) return
		// Remote-sourced so it isn't reported to Claude as a user edit.
		editor.store.mergeRemoteChanges(() => {
			editor.updateShape({ id: shape.id, type: HTML_PAGE_TYPE, props: { h } })
		})
	})
}
