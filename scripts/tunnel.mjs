// Sets up Tailscale so that:
//   - the canvas app is PRIVATE to your devices at https://<mac>.<tailnet>.ts.net:8443  (Tailscale Serve)
//   - only the Claude connector is PUBLIC at https://<mac>.<tailnet>.ts.net/mcp/<token>  (Tailscale Funnel, port 443)
// Funnel applies to a whole port, so the public port (443, which cloud services can always reach)
// carries only /mcp, and the app lives on 8443, tailnet-only.
//
//   npm run tunnel          set up (run while `npm run dev` is running)
//   npm run tunnel -- off   remove both
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'

const PORT = process.env.PORT || 5173
const candidates = ['tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale', '/opt/homebrew/bin/tailscale', '/usr/local/bin/tailscale']
const bin = candidates.find((c) => {
	try {
		execFileSync(c, ['version'], { stdio: 'ignore' })
		return true
	} catch {
		return false
	}
})
if (!bin) {
	console.error('Tailscale not found. Install it from https://tailscale.com/download (Mac and iPad), sign in on both, then rerun.')
	process.exit(1)
}
const run = (args) => {
	console.log(`$ tailscale ${args.join(' ')}`)
	try {
		execFileSync(bin, args, { stdio: 'inherit' })
	} catch {
		console.error('\nThat step needs your approval (see the link above, if any). Approve it, then run `npm run tunnel` again.')
		process.exit(1)
	}
}

if (process.argv.includes('off')) {
	try { run(['funnel', '--https=443', 'off']) } catch {}
	try { run(['serve', '--https=8443', 'off']) } catch {}
	console.log('\nTailscale Serve and Funnel are off. The app is still on your Wi-Fi at the usual address.')
	process.exit(0)
}

const status = JSON.parse(execFileSync(bin, ['status', '--json']).toString())
const host = status?.Self?.DNSName?.replace(/\.$/, '')
if (!host) {
	console.error('Tailscale is not connected. Open the Tailscale app and sign in.')
	process.exit(1)
}

// Private: the whole app, only reachable from devices on your tailnet.
run(['serve', '--bg', '--https=8443', `http://127.0.0.1:${PORT}`])
// Public: only /mcp, on its own port.
run(['funnel', '--bg', '--https=443', '--set-path', '/mcp', `http://127.0.0.1:${PORT}/mcp`])

let token = '<token>'
try {
	token = JSON.parse(fs.readFileSync('.data/auth.json', 'utf8')).connectorToken
} catch {}
console.log(`
Done.
  Canvas (private, open on your iPad):  https://${host}:8443
  Connector URL (public, paste into Claude Duet → Settings → Connections → Add custom connector):
    https://${host}/mcp/${token}

If Tailscale asked you to enable HTTPS certificates or Funnel, follow its link, then rerun this command.
Keep the connector URL secret. Turn the public part off with: npm run tunnel -- off
`)
