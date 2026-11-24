import fs from 'node:fs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { renderTemplate, TEMPLATE_NAMES } from '../duet/templates'
// Render each template with sample data and write a preview page.
const samples: Record<string, any> = {
	daily_brief: { date: 'Monday, November 23', lede: 'The Marcus call decides the charter.', events: [{ time: '9:30', title: 'Call with Marcus', prep: 'Ask about option pool first.' }, { time: '1:00', title: 'Lunch · Leo' }], priorities: ['Charter owner'], approvals: [{ what: 'Send advising-terms note to Priya' }] },
	meeting_agenda: { title: 'Call with Marcus', when: 'Wed 9:30', people: ['You', 'Marcus'], goal: 'Owner for the charter.', items: [{ title: 'option pool', minutes: 10 }, { title: 'Charter', context: 'Fernwood Legal vs counsel' }] },
	email_draft: { to: 'Priya', cc: 'Leo', subject: 'Advising terms', body: 'Hi Priya,\n\nTuesday works.\n\nBest,\nAlex' },
	decision_memo: { question: 'Who drafts the charter?', options: [{ name: 'Fernwood Legal', pro: 'fast' }, { name: 'Counsel', con: 'slow' }], recommendation: 'Counsel.' },
	inbox_triage: { messages: [{ from: 'Priya', subject: 'Terms', gist: 'Needs a yes.' }] },
	weekly_review: { range: 'Nov 16–22', days: [{ day: 'Mon', note: 'calls' }], done: ['Pricing doc'], open: ['Lakeview ask'] },
}
const { CANVAS_KIT_CSS } = await import('../../shared/canvasKit')
let out = ''
for (const n of TEMPLATE_NAMES) {
	const { title, html } = renderTemplate(n, samples[n])
	out += `<h3 style="font-family:sans-serif">${title}</h3><iframe style="width:720px;height:1100px;border:1px solid #ccc" srcdoc="${html.replace('<head>', `<head><style>${CANVAS_KIT_CSS}</style>`).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"></iframe>`
}
fs.writeFileSync(process.argv[2], `<!doctype html><body style="margin:20px">${out}</body>`)
const { buildServerForTest } = await import('../duet/mcp')
const [a, b] = InMemoryTransport.createLinkedPair()
await buildServerForTest().connect(a)
const c = new Client({ name: 't', version: '1' }); await c.connect(b)
const t = (await c.listTools()).tools.find((x) => x.name === 'show_template')!
console.log(t.description!.split('Data fields per template:')[1].split('When none')[0])
process.exit(0)
