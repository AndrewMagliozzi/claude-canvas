import { z } from 'zod'
import { canvasTrayHtml } from '../../shared/canvasKit'

/**
 * Data-driven page templates for Claude Duet (and any Claude using the connector).
 * Each renders kit-styled HTML with machine-readable choices, so Pencil marks
 * come back as answers. Claude can go beyond these with show_page + the kit.
 */

const esc = (s: unknown) =>
	String(s ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')

const attr = esc

function choices(question: string, options: { label: string; hint?: string; confirm?: boolean; cls?: string }[], tiles = false) {
	if (tiles) {
		return `<div class="cc-grid-3" style="grid-template-columns:repeat(${options.length},minmax(0,1fr));gap:12px" data-cc-question="${attr(question)}">${options
			.map(
				(o) =>
					`<div class="cc-choice-tile ${o.cls ?? ''}" data-cc-option="${attr(o.label)}"${o.confirm ? ' data-cc-confirm' : ''}>${esc(o.label)}${o.hint ? `<small>${esc(o.hint)}</small>` : ''}</div>`
			)
			.join('')}</div>`
	}
	return `<div class="cc-choices" data-cc-question="${attr(question)}">${options
		.map((o) => `<span class="cc-choice ${o.cls ?? ''}" data-cc-option="${attr(o.label)}"${o.confirm ? ' data-cc-confirm' : ''}>${esc(o.label)}</span>`)
		.join('')}</div>`
}

function doc(title: string, body: string, tray = true) {
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title></head><body style="margin:0;background:#fffdf8"><main class="cc-page">${body}${tray ? canvasTrayHtml() : ''}</main></body></html>`
}

function header(eyebrow: string, title: string, lede?: string) {
	return `<header class="cc-stack" style="gap:8px"><span class="cc-eyebrow">${esc(eyebrow)}</span><h1 class="cc-title">${esc(title)}</h1>${lede ? `<p class="cc-lede">${esc(lede)}</p>` : ''}</header>`
}

// ---------------------------------------------------------------------------

export const TEMPLATE_SCHEMAS = {
	daily_brief: z.object({
		date: z.string().describe('e.g. "Monday, November 23"'),
		lede: z.string().optional().describe('The one sentence that matters most today'),
		events: z.array(z.object({ time: z.string(), title: z.string(), prep: z.string().optional() })).max(10),
		priorities: z.array(z.string()).max(3).optional().describe('Up to 3; blanks are left for the person'),
		approvals: z.array(z.object({ what: z.string() })).max(4).optional().describe('Things waiting for their OK'),
	}),
	meeting_agenda: z.object({
		title: z.string(),
		when: z.string().describe('e.g. "Wed 9:30–10:00 · Zoom"'),
		people: z.array(z.string()).optional(),
		goal: z.string().optional(),
		items: z.array(z.object({ title: z.string(), context: z.string().optional(), minutes: z.number().optional() })).min(1).max(8),
		afterActions: z.array(z.string()).optional().describe('Follow-ups the person can tick for Duet, e.g. "Send a recap"'),
	}),
	email_draft: z.object({
		heading: z.string().optional().describe('What this email is, e.g. "Advising terms, for Tuesday"'),
		to: z.string(),
		cc: z.string().optional(),
		subject: z.string(),
		body: z.string().describe('Plain text; blank lines separate paragraphs'),
		context: z.string().optional().describe('One line on why now'),
	}),
	decision_memo: z.object({
		question: z.string(),
		due: z.string().optional(),
		context: z.string().optional(),
		options: z
			.array(z.object({ name: z.string(), pro: z.string().optional(), con: z.string().optional(), cost: z.string().optional() }))
			.min(2)
			.max(4),
		recommendation: z.string().optional(),
	}),
	inbox_triage: z.object({
		since: z.string().optional(),
		headline: z.string().optional().describe('e.g. "6 that need you"'),
		messages: z.array(z.object({ from: z.string(), subject: z.string(), when: z.string().optional(), gist: z.string() })).min(1).max(8),
	}),
	weekly_review: z.object({
		range: z.string().describe('e.g. "Nov 16–22"'),
		headline: z.string().optional(),
		days: z.array(z.object({ day: z.string(), note: z.string().optional(), busy: z.boolean().optional() })).max(7).optional(),
		done: z.array(z.string()).optional(),
		open: z.array(z.string()).optional(),
	}),
	approvals_sweep: z.object({
		title: z.string().optional().describe('e.g. "9 things waiting on you"'),
		note: z.string().optional(),
		items: z
			.array(
				z.object({
					what: z.string().describe('The action, e.g. "Send advising-terms note to Priya"'),
					detail: z.string().optional().describe('One line of context or the key content'),
					options: z.array(z.string()).min(2).max(5).optional().describe('Default: Approve, Edit, Skip'),
					actsOutside: z.boolean().optional().describe('Default true: approving sends/pays/books something'),
				})
			)
			.min(1)
			.max(14),
	}),
	document_markup: z.object({
		title: z.string(),
		kind: z.string().optional().describe('e.g. "Contract clause", "Board memo draft"'),
		ask: z.string().optional().describe('What you want from them, e.g. "Strike what to cut, write what to change"'),
		paragraphs: z.array(z.string()).min(1).max(16),
	}),
	operating_manual: z.object({
		title: z.string().optional().describe('Default "How we work together"'),
		intro: z.string().optional(),
		version: z.string().optional().describe('e.g. "v3 · Nov 23"'),
		sections: z
			.array(
				z.object({
					name: z.string().describe('e.g. "Approvals", "Calendar", "Communication", "People", "Check-ins"'),
					rules: z.array(z.string()).max(8).describe('Rules you propose or already follow, one sentence each'),
				})
			)
			.min(1)
			.max(7),
	}),
	preferences: z.object({
		title: z.string().optional().describe('e.g. "A few quick preferences"'),
		intro: z.string().optional(),
		questions: z
			.array(z.object({ question: z.string(), options: z.array(z.string()).min(2).max(6), other: z.boolean().optional().describe('Add an "other: ___" blank (default true)') }))
			.min(1)
			.max(12),
	}),
	plan: z.object({
		title: z.string().optional(),
		horizon: z.string().describe('e.g. "Q1 2027", "This month", "Next 6 weeks"'),
		intro: z.string().optional(),
		goals: z
			.array(
				z.object({
					goal: z.string(),
					why: z.string().optional(),
					keyResults: z.array(z.string()).max(4).optional(),
					duetHelps: z.string().optional().describe('What you will do for this goal'),
				})
			)
			.min(1)
			.max(5),
	}),
} as const

export type TemplateName = keyof typeof TEMPLATE_SCHEMAS
export const TEMPLATE_NAMES = Object.keys(TEMPLATE_SCHEMAS) as TemplateName[]

export const TEMPLATE_DESCRIPTIONS: Record<TemplateName, string> = {
	daily_brief: 'Morning page: the day’s events to tick, three priorities, items waiting for an OK (circle Approve/Edit/Hold).',
	meeting_agenda: 'Agenda to run a meeting by: items with outcome lines, actions/owners, follow-ups to tick for Duet.',
	email_draft: 'An email for approval: the draft with a margin for edits, then circle Send / Send with edits / Redraft / Hold.',
	decision_memo: 'Options side by side with pros/cons/cost, your recommendation, then circle A/B/C, confidence, "because".',
	inbox_triage: 'Messages that need the person: circle Reply / Delegate / Later / Archive per row, a word for how to reply.',
	weekly_review: 'The week at a glance, done vs open (keep/move/drop), and next week’s one big thing.',
	approvals_sweep: 'Every pending approval on one sheet: they circle a choice per row in one pass; you then confirm them all in ONE chat message.',
	document_markup: 'A draft, contract or memo to redline by hand: strike, circle, write between lines or in each paragraph’s margin; you get exact edits back.',
	operating_manual: 'The rules you work by, to agree together: per rule they circle Keep / Change / Drop and write changes; blank lines per section for new rules. Save the result with save_operating_manual.',
	preferences: 'A quick interview: circle-one questions (with an "other" blank) to learn how they like things done.',
	plan: 'Goals for a period with key results, a confidence line and what you’ll do for each; tells you what to prioritise and track.',
}

/** Rough page height so the camera frames it well before it auto-fits. */
export function estimateHeight(name: TemplateName, data: any): number {
	const n = (a: unknown[] | undefined) => (a ? a.length : 0)
	switch (name) {
		case 'daily_brief':
			return 560 + n(data.events) * 74 + Math.max(n(data.approvals), 2) * 40
		case 'meeting_agenda':
			return 620 + n(data.items) * 120
		case 'email_draft':
			return 760 + Math.ceil(String(data.body ?? '').length / 60) * 28
		case 'decision_memo':
			return 1000
		case 'inbox_triage':
			return 420 + n(data.messages) * 118
		case 'weekly_review':
			return 1040
		case 'approvals_sweep':
			return 360 + n(data.items) * 96
		case 'operating_manual':
			return 360 + (data.sections ?? []).reduce((h: number, s: any) => h + 150 + (s.rules?.length ?? 0) * 86, 0)
		case 'preferences':
			return 300 + n(data.questions) * 92
		case 'plan':
			return 380 + n(data.goals) * 230
		case 'document_markup':
			return 420 + (data.paragraphs ?? []).reduce((h: number, p: string) => h + 40 + Math.ceil(p.length / 55) * 30, 0)
	}
}

export function renderTemplate(name: TemplateName, data: any): { title: string; html: string } {
	switch (name) {
		case 'daily_brief': {
			const d = data as z.infer<(typeof TEMPLATE_SCHEMAS)['daily_brief']>
			const priorities = [...(d.priorities ?? [])]
			while (priorities.length < 3) priorities.push('')
			const body = `${header('Daily brief · from Claude Duet', d.date, d.lede)}
<section><div class="cc-section-head"><h2 class="cc-h2">Today</h2><span class="cc-hint">tick when done · write in the margin</span></div>
${d.events
	.map(
		(e) =>
			`<div class="cc-row"><span class="cc-row-time">${esc(e.time)}</span><span class="cc-box" data-cc-question="${attr(e.title)}" data-cc-option="done"></span><div class="cc-stack" style="gap:3px"><span class="cc-row-title">${esc(e.title)}</span>${e.prep ? `<span class="cc-row-sub">${esc(e.prep)}</span>` : ''}</div><span class="cc-margin"></span></div>`
	)
	.join('')}</section>
<section class="cc-grid-2" style="column-gap:32px">
<div class="cc-stack" style="gap:14px"><h2 class="cc-h2">Three things</h2>${priorities
				.map((p, i) => `<div style="display:flex;gap:10px;align-items:flex-end"><span class="cc-num" style="width:18px">${i + 1}</span><span class="cc-line" style="flex:1;font-size:15px;color:var(--cc-ink-2);padding-bottom:4px">${esc(p)}</span></div>`)
				.join('')}<span class="cc-hint">★ star the one to protect</span></div>
<div class="cc-stack" style="gap:14px"><h2 class="cc-h2">Needs your OK</h2>${
				(d.approvals ?? []).length
					? (d.approvals ?? [])
							.map(
								(a) =>
									`<div class="cc-card" style="padding:10px 12px;gap:6px;border-radius:8px"><span style="font-size:14px;line-height:1.4">${esc(a.what)}</span>${choices(a.what, [{ label: 'Approve', confirm: true, cls: 'cc-choice-primary' }, { label: 'Edit' }, { label: 'Hold', cls: 'cc-choice-quiet' }])}</div>`
							)
							.join('')
					: '<span class="cc-hint">Nothing waiting. Nice.</span>'
			}<span class="cc-hint">circle one per item</span></div>
</section>`
			return { title: `Daily brief · ${d.date}`, html: doc(`Daily brief`, body) }
		}
		case 'meeting_agenda': {
			const d = data as z.infer<(typeof TEMPLATE_SCHEMAS)['meeting_agenda']>
			const after = d.afterActions ?? ['Send a recap to everyone', 'Book the follow-up', 'Turn actions into tasks']
			const body = `<header class="cc-stack" style="gap:8px"><span class="cc-eyebrow">Agenda · ${esc(d.when)}</span><h1 class="cc-title">${esc(d.title)}</h1>${
				d.people?.length ? `<div class="cc-row-flex" style="gap:8px">${d.people.map((p) => `<span class="cc-pill">${esc(p)}</span>`).join('')}</div>` : ''
			}</header>
${d.goal ? `<div class="cc-callout"><span class="cc-eyebrow">Goal</span><span class="cc-callout-text">${esc(d.goal)}</span></div>` : ''}
<section><div class="cc-section-head" style="display:grid;grid-template-columns:36px minmax(0,1fr) 60px;column-gap:14px"><span class="cc-h2">✓</span><span class="cc-h2">Item</span><span class="cc-h2" style="text-align:right">Min</span></div>
${d.items
	.map(
		(it, i) =>
			`<div style="display:grid;grid-template-columns:36px minmax(0,1fr) 60px;column-gap:14px;padding:16px 0 14px;border-bottom:1px solid var(--cc-rule)"><span class="cc-box" style="margin-top:2px" data-cc-question="${attr(it.title)}" data-cc-option="done"></span><div class="cc-stack" style="gap:8px"><span style="font-size:17px;font-weight:600"><span class="cc-num" style="font-size:17px;margin-right:6px">${i + 1}</span>${esc(it.title)}</span>${
				it.context ? `<span class="cc-row-sub">${esc(it.context)}</span>` : ''
			}<span class="cc-field">Outcome<span class="cc-line"></span></span></div><span class="cc-muted" style="text-align:right;font-size:14px">${it.minutes ?? ''}</span></div>`
	)
	.join('')}</section>
<section class="cc-grid-2" style="column-gap:28px"><div class="cc-stack" style="gap:10px"><h2 class="cc-h2">Actions · owner</h2><span class="cc-line"></span><span class="cc-line"></span><span class="cc-line"></span></div>
<div class="cc-stack" style="gap:10px"><h2 class="cc-h2">Afterwards, Duet should</h2>${after
				.map((a) => `<span class="cc-check" style="font-size:14px" data-cc-question="After the meeting: ${attr(a)}"><span class="cc-box" style="width:20px;height:20px" data-cc-option="yes" data-cc-confirm></span>${esc(a)}</span>`)
				.join('')}</div></section>`
			return { title: d.title, html: doc(d.title, body) }
		}
		case 'email_draft': {
			const d = data as z.infer<(typeof TEMPLATE_SCHEMAS)['email_draft']>
			const paragraphs = d.body
				.split(/\n\s*\n/)
				.map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`)
				.join('')
			const q = `Email to ${d.to}: ${d.subject}`
			const body = `${header('Draft for your OK · Duet won’t send until you approve', d.heading ?? d.subject, d.context)}
<div style="display:grid;grid-template-columns:minmax(0,1fr) 150px;column-gap:20px">
<article class="cc-email"><div class="cc-email-head"><span class="cc-muted">To</span><span>${esc(d.to)}</span>${d.cc ? `<span class="cc-muted">Cc</span><span>${esc(d.cc)}</span>` : ''}<span class="cc-muted">Subject</span><span style="font-weight:600">${esc(d.subject)}</span></div><div class="cc-email-body">${paragraphs}</div></article>
<div class="cc-stack" style="gap:10px;padding-top:8px"><span class="cc-hint" style="line-height:1.4">Margin: write changes here, or strike and insert in the text.</span><span class="cc-margin" style="flex:1;min-height:300px"></span></div></div>
<section class="cc-decision"><h2 class="cc-h2">Your call · circle one</h2>${choices(
				q,
				[
					{ label: 'Send', hint: 'as written', confirm: true, cls: 'cc-choice-primary' },
					{ label: 'Send with edits', hint: 'my marks', confirm: true },
					{ label: 'Redraft', hint: 'try again' },
					{ label: 'Hold', hint: 'not yet', cls: 'cc-choice-quiet' },
				],
				true
			)}<span class="cc-field">Send at<span class="cc-line" style="flex:none;width:180px"></span><span>(blank = now)</span></span></section>`
			return { title: `Email: ${d.subject}`, html: doc(d.subject, body) }
		}
		case 'decision_memo': {
			const d = data as z.infer<(typeof TEMPLATE_SCHEMAS)['decision_memo']>
			const letters = d.options.map((_, i) => String.fromCharCode(65 + i))
			const body = `${header(`Decision${d.due ? ` · due ${d.due}` : ''}`, d.question, d.context)}
<section class="cc-grid-3" style="grid-template-columns:repeat(${d.options.length},minmax(0,1fr))">${d.options
				.map(
					(o, i) =>
						`<div class="cc-card"><span class="cc-num" style="font-size:28px;line-height:1">${letters[i]}</span><span style="font-size:16px;font-weight:600;line-height:1.3">${esc(o.name)}</span>${
							o.pro ? `<span style="font-size:13px;line-height:1.45"><span class="cc-good" style="font-weight:700">+</span> ${esc(o.pro)}</span>` : ''
						}${o.con ? `<span style="font-size:13px;line-height:1.45"><span class="cc-warn" style="font-weight:700">−</span> ${esc(o.con)}</span>` : ''}${
							o.cost ? `<span class="cc-hint" style="margin-top:auto">${esc(o.cost)}</span>` : ''
						}</div>`
				)
				.join('')}</section>
${d.recommendation ? `<div class="cc-callout"><span class="cc-eyebrow">Duet’s recommendation</span><span class="cc-callout-text">${esc(d.recommendation)}</span></div>` : ''}
<section class="cc-decision"><div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap"><h2 class="cc-h2">Your decision · circle one</h2>${choices(d.question, [
				...letters.map((l, i) => ({ label: l, hint: d.options[i].name, cls: 'cc-choice-big' })),
				{ label: 'none yet', cls: 'cc-choice-quiet' },
			])}</div>
<div class="cc-stack" style="gap:8px"><span class="cc-hint">Confidence · mark the line</span><div class="cc-scale"><div class="cc-scale-labels"><span>guess</span><span>leaning</span><span>sure</span></div></div></div>
<span class="cc-field">Because<span class="cc-line"></span></span></section>`
			return { title: `Decision: ${d.question}`, html: doc(d.question, body) }
		}
		case 'inbox_triage': {
			const d = data as z.infer<(typeof TEMPLATE_SCHEMAS)['inbox_triage']>
			const body = `<header style="display:flex;justify-content:space-between;align-items:flex-end;gap:16px"><div class="cc-stack" style="gap:8px"><span class="cc-eyebrow">Inbox triage${d.since ? ` · ${esc(d.since)}` : ''}</span><h1 class="cc-title">${esc(d.headline ?? `${d.messages.length} that need you`)}</h1></div><span class="cc-hint" style="text-align:right;line-height:1.4">circle one per row<br>a word in the blank = how to reply</span></header>
<section>${d.messages
				.map(
					(m) =>
						`<div class="cc-stack" style="gap:10px;padding:16px 0 14px;border-top:1px solid var(--cc-rule)"><div style="display:flex;justify-content:space-between;gap:12px;align-items:baseline"><span style="font-size:16px;font-weight:600">${esc(m.from)} <span class="cc-muted" style="font-weight:400">· ${esc(m.subject)}</span></span><span class="cc-hint" style="white-space:nowrap">${esc(m.when ?? '')}</span></div><span style="font-size:14px;line-height:1.45;color:var(--cc-ink-2)">${esc(m.gist)}</span><div style="display:flex;align-items:flex-end;gap:16px">${choices(`${m.from}: ${m.subject}`, [
							{ label: 'Reply', cls: 'cc-choice-primary' },
							{ label: 'Delegate' },
							{ label: 'Later' },
							{ label: 'Archive', cls: 'cc-choice-quiet' },
						])}<span class="cc-line" style="flex:1;min-height:20px"></span></div></div>`
				)
				.join('')}</section>`
			return { title: `Inbox triage`, html: doc('Inbox triage', body) }
		}
		case 'approvals_sweep': {
			const d = data as z.infer<(typeof TEMPLATE_SCHEMAS)['approvals_sweep']>
			const body = `${header('Decision sweep · one pass, one confirmation', d.title ?? `${d.items.length} things waiting on you`, d.note ?? 'Circle one per row. When you’re done, tell Duet “check my iPad”: it lists everything you marked and asks once before doing any of it.')}
<section>${d.items
				.map((it, i) => {
					const opts = it.options ?? ['Approve', 'Edit', 'Skip']
					const outside = it.actsOutside !== false
					return `<div style="display:grid;grid-template-columns:34px minmax(0,1fr);column-gap:14px;padding:16px 0 14px;border-top:1px solid var(--cc-rule)"><span class="cc-num">${i + 1}</span><div class="cc-stack" style="gap:8px"><span style="font-size:16px;font-weight:600;line-height:1.35">${esc(it.what)}</span>${
						it.detail ? `<span class="cc-row-sub">${esc(it.detail)}</span>` : ''
					}${choices(
						`${i + 1}. ${it.what}`,
						opts.map((o, k) => ({ label: o, confirm: outside && k === 0, cls: k === 0 ? 'cc-choice-primary' : k === opts.length - 1 ? 'cc-choice-quiet' : '' }))
					)}</div></div>`
				})
				.join('')}</section>`
			return { title: d.title ?? 'Decision sweep', html: doc('Decision sweep', body) }
		}
		case 'document_markup': {
			const d = data as z.infer<(typeof TEMPLATE_SCHEMAS)['document_markup']>
			const body = `${header(`${d.kind ?? 'Draft'} · mark it up`, d.title, d.ask ?? 'Strike what to cut, circle what to question, write changes between the lines or in the margin.')}
<section class="cc-stack" style="gap:0">${d.paragraphs
				.map(
					(p, i) =>
						`<div style="display:grid;grid-template-columns:28px minmax(0,1fr) 170px;column-gap:14px;padding:12px 0;border-top:1px solid var(--cc-rule)"><span class="cc-hint" style="padding-top:6px">¶${i + 1}</span><p class="cc-prose" style="margin:0;line-height:2.1" data-cc-region="para:${i + 1}">${esc(p)}</p><div class="cc-margin" style="min-height:60px" data-cc-region="margin:${i + 1}"></div></div>`
				)
				.join('')}</section>`
			return { title: `Markup: ${d.title}`, html: doc(d.title, body) }
		}
		case 'operating_manual': {
			const d = data as z.infer<(typeof TEMPLATE_SCHEMAS)['operating_manual']>
			const body = `${header(`Operating manual${d.version ? ` · ${d.version}` : ''}`, d.title ?? 'How we work together', d.intro ?? 'For each rule, circle Keep, Change or Drop, and write the change on its line. Add your own rules at the end of each section. Duet saves the result and follows it.')}
${d.sections
	.map(
		(s) => `<section><div class="cc-section-head"><h2 class="cc-h2">${esc(s.name)}</h2><span class="cc-hint">keep · change · drop</span></div>${s.rules
			.map(
				(r, i) =>
					`<div class="cc-stack" style="gap:6px;padding:14px 0 12px;border-bottom:1px solid var(--cc-rule)"><div style="display:flex;justify-content:space-between;gap:16px;align-items:flex-start"><span style="font-family:var(--cc-serif);font-size:16px;line-height:1.5;flex:1">${esc(r)}</span>${choices(`${s.name} rule ${i + 1}: ${r}`, [
						{ label: 'Keep', cls: 'cc-choice-primary' },
						{ label: 'Change' },
						{ label: 'Drop', cls: 'cc-choice-quiet' },
					])}</div><span class="cc-line" style="min-height:22px" data-cc-region="rule:${attr(s.name)}:${i + 1}"></span></div>`
			)
			.join('')}<div class="cc-stack" style="gap:8px;padding-top:12px" data-cc-region="new-rules:${attr(s.name)}"><span class="cc-hint">Add a rule</span><span class="cc-line"></span><span class="cc-line"></span></div></section>`
	)
	.join('')}`
			return { title: d.title ?? 'How we work together', html: doc('Operating manual', body) }
		}
		case 'preferences': {
			const d = data as z.infer<(typeof TEMPLATE_SCHEMAS)['preferences']>
			const body = `${header('Preferences · circle one', d.title ?? 'A few quick preferences', d.intro ?? 'Circle what fits. Write in “other” if nothing does. Duet adds your answers to its operating manual.')}
<section>${d.questions
				.map(
					(q, i) =>
						`<div class="cc-stack" style="gap:10px;padding:14px 0;border-top:1px solid var(--cc-rule)"><span style="font-size:16px;font-weight:600"><span class="cc-num" style="font-size:17px;margin-right:8px">${i + 1}</span>${esc(q.question)}</span>${choices(q.question, q.options.map((o) => ({ label: o })))}${
							q.other === false ? '' : `<span class="cc-field" data-cc-region="other:${i + 1}">other<span class="cc-line"></span></span>`
						}</div>`
				)
				.join('')}</section>`
			return { title: d.title ?? 'Preferences', html: doc('Preferences', body) }
		}
		case 'plan': {
			const d = data as z.infer<(typeof TEMPLATE_SCHEMAS)['plan']>
			const body = `${header(`Plan · ${d.horizon}`, d.title ?? 'What matters, and how we’ll know', d.intro ?? 'Strike or rewrite any goal, mark your confidence, and tick what Duet should track. Duet saves the plan and works to it.')}
${d.goals
	.map(
		(g, i) => `<section class="cc-card" style="gap:12px"><div style="display:flex;gap:12px;align-items:baseline"><span class="cc-num" style="font-size:26px">${i + 1}</span><div class="cc-stack" style="gap:4px;flex:1"><span style="font-family:var(--cc-serif);font-size:20px;font-weight:600;line-height:1.3" data-cc-region="goal:${i + 1}">${esc(g.goal)}</span>${g.why ? `<span class="cc-row-sub">${esc(g.why)}</span>` : ''}</div></div>
${(g.keyResults ?? []).length ? `<div class="cc-stack" style="gap:6px">${(g.keyResults ?? []).map((k) => `<span class="cc-check" style="font-size:14px" data-cc-question="Goal ${i + 1} key result: ${attr(k)}"><span class="cc-box" style="width:18px;height:18px" data-cc-option="done"></span>${esc(k)}</span>`).join('')}</div>` : ''}
<div class="cc-stack" style="gap:6px"><span class="cc-hint">Confidence · mark the line</span><div class="cc-scale" data-cc-region="confidence:${i + 1}"><div class="cc-scale-labels"><span>unlikely</span><span>maybe</span><span>will happen</span></div></div></div>
${g.duetHelps ? `<span class="cc-check" style="font-size:14px" data-cc-question="Goal ${i + 1}: Duet tracks it"><span class="cc-box" style="width:18px;height:18px" data-cc-option="yes"></span><span><b>Duet’s part:</b> ${esc(g.duetHelps)}</span></span>` : ''}
<span class="cc-field" data-cc-region="goal-notes:${i + 1}">Notes<span class="cc-line"></span></span></section>`
	)
	.join('')}
<section class="cc-decision"><h2 class="cc-h2">Not doing this ${esc(d.horizon)}</h2><span class="cc-line"></span><span class="cc-line"></span></section>`
			return { title: `Plan · ${d.horizon}`, html: doc('Plan', body) }
		}
		case 'weekly_review': {
			const d = data as z.infer<(typeof TEMPLATE_SCHEMAS)['weekly_review']>
			const days = d.days ?? []
			const body = `${header(`Weekly review · ${d.range}`, d.headline ?? 'The week in one line')}
${days.length ? `<section style="display:grid;grid-template-columns:repeat(${days.length},minmax(0,1fr));gap:6px">${days
				.map((x) => `<div class="cc-stack" style="gap:6px;padding:10px 8px;border-radius:8px;min-height:84px;background:${x.busy ? '#e9eefb' : 'var(--cc-sand)'}"><span style="font-size:12px;font-weight:700">${esc(x.day)}</span><span style="font-size:12px;line-height:1.35;color:var(--cc-ink-2)">${esc(x.note ?? '')}</span></div>`)
				.join('')}</section>` : ''}
<section class="cc-grid-2" style="gap:22px"><div class="cc-stack" style="gap:10px"><h2 class="cc-h2">Done</h2>${(d.done ?? [])
				.map((x) => `<span style="font-size:14px;line-height:1.4;display:flex;gap:8px"><span class="cc-good" style="font-weight:700">✓</span>${esc(x)}</span>`)
				.join('')}</div>
<div class="cc-stack" style="gap:10px"><h2 class="cc-h2">Still open · keep, move or drop</h2>${(d.open ?? [])
				.map((x) => `<div class="cc-stack" style="gap:4px"><span style="font-size:14px;line-height:1.4">${esc(x)}</span>${choices(x, [{ label: 'keep' }, { label: 'move' }, { label: 'drop', cls: 'cc-choice-quiet' }])}</div>`)
				.join('')}</div></section>
<section class="cc-decision"><h2 class="cc-h2">Next week · you write, Duet plans</h2><div style="display:grid;grid-template-columns:120px minmax(0,1fr);row-gap:14px;align-items:end;font-size:14px"><span class="cc-muted">One big thing</span><span class="cc-line" style="min-height:24px"></span><span class="cc-muted">Protect time for</span><span class="cc-line" style="min-height:24px"></span><span class="cc-muted">Say no to</span><span class="cc-line" style="min-height:24px"></span></div>
<div style="display:flex;gap:12px;align-items:center;font-size:13px">Energy this week · circle:${choices('Energy this week', ['1', '2', '3', '4', '5'].map((l) => ({ label: l })))}</div></section>`
			return { title: `Weekly review · ${d.range}`, html: doc('Weekly review', body) }
		}
	}
}
