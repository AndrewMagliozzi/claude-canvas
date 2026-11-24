import { query } from '@anthropic-ai/claude-agent-sdk'
const env = { ...process.env }; delete env.ANTHROPIC_API_KEY
// 1x1 red png
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='
async function* msgs() {
  yield { type: 'user', parent_tool_use_id: null, message: { role: 'user', content: [
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png } },
    { type: 'text', text: 'What color is this pixel? Reply as JSON {"color": "..."} only. Also remember the word BANANA.' } ] } } as any
}
const t0 = Date.now(); let sid = ''
for await (const m of query({ prompt: msgs(), options: { model: process.argv[2] || 'sonnet', tools: [], settingSources: [], systemPrompt: 'You are terse.', includePartialMessages: true, env, maxTurns: 1, cwd: process.env.TMPDIR } })) {
  if (m.type === 'system' && (m as any).subtype === 'init') { sid = m.session_id; console.log('init', (m as any).model, (m as any).apiKeySource, Date.now()-t0) }
  if (m.type === 'stream_event') { const e: any = (m as any).event; if (e.type === 'content_block_delta' && e.delta.type==='text_delta') process.stdout.write(e.delta.text) }
  if (m.type === 'result') console.log('\nresult', m.subtype, Date.now()-t0, (m as any).total_cost_usd)
}
for await (const m of query({ prompt: 'What word did I ask you to remember? one word', options: { model: process.argv[2] || 'sonnet', tools: [], settingSources: [], systemPrompt: 'You are terse.', resume: sid, env, maxTurns: 1, cwd: process.env.TMPDIR } })) {
  if (m.type === 'result') console.log('resume result:', (m as any).result, Date.now()-t0)
}
