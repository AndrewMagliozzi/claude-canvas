// Prints the Claude connector URLs (for Claude Duet, Claude chat and Claude Code).
//   npm run connector-url
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const authFile = path.resolve('.data/auth.json')
if (!fs.existsSync(authFile)) {
	console.error('Start the server once first (npm run dev) to create the connector token.')
	process.exit(1)
}
const token = process.env.CONNECTOR_TOKEN || JSON.parse(fs.readFileSync(authFile, 'utf8')).connectorToken
const port = process.env.PORT || 5173
let publicHost = null
for (const bin of ['tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale']) {
	try {
		const status = JSON.parse(execFileSync(bin, ['status', '--json'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString())
		publicHost = status?.Self?.DNSName?.replace(/\.$/, '') || null
		if (publicHost) break
	} catch {}
}
console.log('\nClaude Code (this Mac, no tunnel needed):')
console.log(`  claude mcp add --transport http canvas http://localhost:${port}/mcp/${token}\n`)
console.log('Claude Duet / Claude chat → Settings → Connectors → Add custom connector → MCP server URL:')
console.log(publicHost ? `  https://${publicHost}/mcp/${token}` : '  https://<your-mac>.<tailnet>.ts.net/mcp/' + token + '   (run `npm run tunnel` first — see README)')
console.log('\nKeep this URL secret: anyone with it can see and draw on your canvas.')
console.log('Rotate it with: npm run dev -- --new-connector-token\n')
