import { Box, FileHelpers } from 'tldraw'
import { ScreenshotPart } from '../../shared/schema/PromptPartDefinitions'
import { AgentRequest } from '../../shared/types/AgentRequest'
import { PromptPartUtil, registerPromptPartUtil } from './PromptPartUtil'

export const ScreenshotPartUtil = registerPromptPartUtil(
	class ScreenshotPartUtil extends PromptPartUtil<ScreenshotPart> {
		static override type = 'screenshot' as const

		override async getPart(request: AgentRequest): Promise<ScreenshotPart> {
			const { editor } = this

			const contextBounds = request.bounds

			const contextBoundsBox = Box.From(contextBounds)

			const shapes = editor.getCurrentPageShapesSorted().filter((shape) => {
				const bounds = editor.getShapeMaskedPageBounds(shape)
				if (!bounds) return false
				return contextBoundsBox.includes(bounds)
			})

			if (shapes.length === 0) {
				return { type: 'screenshot', screenshot: '' }
			}

			// Render at roughly the person's screen resolution (so handwriting is legible),
			// capped at ~1568px on the long edge, which is what Claude sees best.
			const largestDimension = Math.max(request.bounds.w, request.bounds.h)
			const zoom = editor.getZoomLevel()
			const scale = Math.min(Math.max(zoom, 0.25) * 1.5, 1568 / largestDimension, 4)

			const opts = {
				format: 'jpeg' as const,
				quality: 0.85,
				background: true,
				bounds: Box.From(request.bounds),
				padding: 0,
				pixelRatio: 1,
				scale,
			}
			let result
			try {
				result = await editor.toImage(shapes, opts)
			} catch (e) {
				// If a page can't be rasterized (e.g. a browser quirk), retry without pages
				// rather than failing the whole turn. Claude still gets their data and marks.
				console.warn('Screenshot failed; retrying without HTML pages', e)
				const withoutPages = shapes.filter((s) => s.type !== 'html-page')
				if (withoutPages.length === 0) return { type: 'screenshot', screenshot: '' }
				result = await editor.toImage(withoutPages, opts)
			}

			return {
				type: 'screenshot',
				screenshot: await FileHelpers.blobToDataUrl(result.blob),
			}
		}
	}
)
