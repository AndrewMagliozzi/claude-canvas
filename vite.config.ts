import { fileURLToPath } from 'url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { zodLocalePlugin } from './scripts/vite-zod-locale-plugin.js'

// The Node server in server/index.ts runs Vite in middleware mode, so `server`
// options here only apply when running `vite` directly.
export default defineConfig(() => {
	return {
		plugins: [
			zodLocalePlugin(fileURLToPath(new URL('./scripts/zod-locales-shim.js', import.meta.url))),
			react(),
		],
		define: {
			// tldraw license key (optional in development). Read from TLDRAW_LICENSE_KEY.
			__TLDRAW_LICENSE_KEY__: JSON.stringify(process.env.TLDRAW_LICENSE_KEY ?? ''),
		},
	}
})
