import { query } from '@anthropic-ai/claude-agent-sdk'
const env: any = { ...process.env }; delete env.ANTHROPIC_API_KEY
const strict = process.argv[2] === 'strict'
for await (const m of query({ prompt: 'say hi', options: { model: 'haiku', tools: [], settingSources: [], systemPrompt: 'terse', env, maxTurns: 1, cwd: process.env.TMPDIR, ...(strict ? { strictMcpConfig: true, mcpServers: {} } : {}) } })) {
  if (m.type === 'system' && (m as any).subtype === 'init') { const i: any = m; console.log(JSON.stringify({ tools: i.tools, mcp: i.mcp_servers, slash: i.slash_commands?.length, skills: i.skills, plugins: i.plugins, agents: i.agents }, null, 0)) }
  if (m.type === 'result') console.log('result', (m as any).result)
}
