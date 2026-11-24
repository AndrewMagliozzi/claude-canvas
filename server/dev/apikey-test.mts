// Dry check of the API-key fallback: with a (fake) key and authMode 'api-key',
// the Claude Code child should report an API-key source instead of the login.
//   ANTHROPIC_API_KEY=sk-ant-fake npx tsx server/dev/apikey-test.mts
import { ClaudeSession } from '../claude/ClaudeSession'
for (const authMode of ['login', 'api-key'] as const) {
	const s = new ClaudeSession({ systemPrompt: 'terse', model: 'haiku', authMode })
	let err = ''
	try {
		for await (const ev of s.turn([{ type: 'text', text: 'say hi' }], { signal: new AbortController().signal })) {
			if (ev.type === 'result') err = ev.ok ? 'ok' : `error: ${ev.error}`
		}
	} catch (e: any) {
		err = 'threw: ' + e.message
	}
	console.log(authMode, '->', (s as any).lastApiKeySource, err.slice(0, 200))
	s.close()
}
