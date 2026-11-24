/**
 * The Claude Canvas design kit: one stylesheet injected into every HTML page
 * on the canvas, so templates and pages Claude composes on the fly share the
 * same paper look and the same Pencil-friendly parts.
 *
 * Interaction hooks (read back when the person marks a page):
 *   data-cc-question="…" on a group, data-cc-option="…" on each choice
 *     → a circle or tick on an option comes back as an answer to that question
 *   data-cc-confirm   on an option that triggers an outward action (send, pay…)
 *     → the answer is flagged: confirm in chat before acting
 *   data-cc-region="tray" on the Hand-to-Duet tray
 *     → writing there comes back as a new request
 */
export const CANVAS_KIT_CSS = `
:root{--cc-paper:#fffdf8;--cc-ink:#1d1d1f;--cc-ink-2:#3d3a35;--cc-muted:#5f5a52;--cc-rule:#e6e0d4;--cc-line:#b9b1a2;--cc-card:#ffffff;--cc-sand:#f3efe6;--cc-accent:#2b4fc4;--cc-accent-wash:#f6f8fe;--cc-good:#1f6f5c;--cc-warn:#b5532f;--cc-serif:'Iowan Old Style',Georgia,'Times New Roman',serif;--cc-sans:-apple-system,'Helvetica Neue',Helvetica,Arial,sans-serif}
.cc-page{box-sizing:border-box;width:100%;min-height:100%;padding:48px 56px 40px;background:var(--cc-paper);color:var(--cc-ink);font-family:var(--cc-sans);display:flex;flex-direction:column;gap:26px;-webkit-font-smoothing:antialiased}
.cc-page *{box-sizing:border-box}
.cc-stack{display:flex;flex-direction:column;gap:12px}
.cc-row-flex{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.cc-grid-2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px}
.cc-grid-3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
.cc-eyebrow{font-size:12px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--cc-muted)}
.cc-title{margin:0;font-family:var(--cc-serif);font-size:36px;font-weight:600;line-height:1.15}
.cc-lede{margin:0;font-family:var(--cc-serif);font-size:18px;line-height:1.5;color:var(--cc-ink-2);max-width:580px}
.cc-prose{font-family:var(--cc-serif);font-size:17px;line-height:1.7}
.cc-prose p{margin:0 0 14px}
.cc-h2{margin:0;font-size:13px;font-weight:700;letter-spacing:.1em;text-transform:uppercase}
.cc-section-head{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding-bottom:10px;border-bottom:1.5px solid var(--cc-ink)}
.cc-hint{font-size:12px;color:var(--cc-muted)}
.cc-muted{color:var(--cc-muted)}
.cc-row{display:grid;grid-template-columns:64px 30px minmax(0,1fr) 140px;column-gap:12px;align-items:start;padding:14px 0;border-bottom:1px solid var(--cc-rule)}
.cc-row-time{font-size:14px;font-variant-numeric:tabular-nums;color:var(--cc-muted);padding-top:2px}
.cc-row-title{font-size:16px;font-weight:600}
.cc-row-sub{font-size:14px;line-height:1.45;color:var(--cc-muted)}
.cc-margin{border-left:1px dashed #d6cfc1;min-height:40px}
.cc-box{display:inline-block;width:22px;height:22px;border:1.5px solid var(--cc-ink);border-radius:4px;flex:none;vertical-align:middle}
.cc-check{display:flex;gap:10px;align-items:center;font-size:15px}
.cc-line{display:block;min-height:30px;border-bottom:1.5px solid var(--cc-line)}
.cc-blank{display:inline-block;min-width:160px;height:22px;border-bottom:1.5px solid var(--cc-line);vertical-align:bottom}
.cc-field{display:flex;gap:10px;align-items:flex-end;font-size:13px;color:var(--cc-muted)}
.cc-field .cc-line{flex:1;min-height:22px}
.cc-choices{display:flex;gap:22px;flex-wrap:wrap;align-items:center}
.cc-choice{display:inline-block;padding:6px 10px;font-size:15px;font-weight:600;color:var(--cc-ink);border-radius:999px}
.cc-choice-big{font-family:var(--cc-serif);font-size:26px;font-weight:600;padding:4px 12px}
.cc-choice-primary{color:var(--cc-accent)}
.cc-choice-quiet{color:var(--cc-muted)}
.cc-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
.cc-choice-tile{display:flex;flex-direction:column;gap:4px;align-items:center;text-align:center;padding:12px 8px;border-radius:10px;background:#f6f3ec;font-size:17px;font-weight:600}
.cc-choice-tile small{font-size:12px;font-weight:400;color:var(--cc-muted)}
.cc-card{padding:16px;border:1px solid #e0d9cb;border-radius:12px;background:var(--cc-card);display:flex;flex-direction:column;gap:8px}
.cc-callout{padding:14px 16px;background:var(--cc-sand);border-radius:10px;display:flex;flex-direction:column;gap:6px}
.cc-callout .cc-eyebrow{font-weight:700}
.cc-callout-text{font-family:var(--cc-serif);font-size:17px;line-height:1.5}
.cc-decision{padding:18px 20px;border:1.5px solid var(--cc-ink);border-radius:12px;display:flex;flex-direction:column;gap:14px}
.cc-pill{display:inline-block;font-size:13px;padding:4px 10px;border:1px solid #d6cfc1;border-radius:999px;color:var(--cc-ink-2)}
.cc-num{font-family:var(--cc-serif);font-size:20px;color:var(--cc-accent)}
.cc-good{color:var(--cc-good)}
.cc-warn{color:var(--cc-warn)}
.cc-scale{position:relative;height:30px}
.cc-scale::before{content:'';position:absolute;left:0;right:0;top:10px;border-top:1.5px solid var(--cc-ink)}
.cc-scale-labels{position:absolute;left:0;right:0;top:16px;display:flex;justify-content:space-between;font-size:11px;color:var(--cc-muted)}
.cc-email{border:1px solid #e0d9cb;border-radius:10px;background:var(--cc-card);overflow:hidden}
.cc-email-head{display:grid;grid-template-columns:64px minmax(0,1fr);row-gap:8px;padding:16px 20px;border-bottom:1px solid #ece6da;font-size:14px}
.cc-email-body{padding:22px 24px;font-family:var(--cc-serif);font-size:17px;line-height:1.75}
.cc-email-body p{margin:0 0 14px}
.cc-tray{margin-top:auto;padding:16px 18px 14px;border:1.5px dashed var(--cc-accent);border-radius:12px;background:var(--cc-accent-wash);display:flex;flex-direction:column;gap:10px}
.cc-tray-head{display:flex;justify-content:space-between;align-items:center;gap:12px}
.cc-tray-label{font-size:13px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--cc-accent)}
.cc-tray .cc-line{border-color:#c9d2ec;min-height:34px}
.cc-tray-hint{font-size:12px;line-height:1.4;color:#4a5068}
`

/** The Hand-to-Duet tray, as HTML. Writing inside it is reported as a new request. */
export function canvasTrayHtml() {
	return `<aside class="cc-tray" data-cc-region="tray" aria-label="Hand to Duet">
<div class="cc-tray-head"><span class="cc-tray-label">✎ Hand to Duet</span><span class="cc-check" style="font-size:13px" data-cc-question="Tray: urgent?" ><span class="cc-box" style="width:18px;height:18px" data-cc-option="urgent"></span>urgent</span></div>
<span class="cc-line"></span><span class="cc-line"></span>
<span class="cc-tray-hint">Write a request, like “send this”, “move my 3pm” or “draft a reply”. Duet picks it up when you say “check my iPad”, or at its next check-in, and asks before sending anything.</span>
</aside>`
}

/** A compact reference of the kit, for Claude (in get_page_guide and the local system prompt). */
export const CANVAS_KIT_REFERENCE = `## Design kit (built into every page)

Every page on the canvas automatically gets the Claude Canvas kit stylesheet, so pages share one look. Wrap content in \`<main class="cc-page">\`, then compose from these parts. Add your own CSS only for what the kit lacks.

- **Type:** \`cc-eyebrow\` (small caps label), \`cc-title\` (serif headline), \`cc-lede\` (serif one-liner), \`cc-h2\` (section label), \`cc-section-head\` (label row with a rule), \`cc-prose\` (serif paragraphs), \`cc-hint\`, \`cc-muted\`.
- **Layout:** \`cc-stack\`, \`cc-row-flex\`, \`cc-grid-2\`, \`cc-grid-3\`, \`cc-card\`, \`cc-callout\` (sand note; inner \`cc-eyebrow\` + \`cc-callout-text\`), \`cc-decision\` (the bordered "your call" box), \`cc-pill\`.
- **Timeline rows:** \`cc-row\` with children \`cc-row-time\`, \`cc-box\`, a div holding \`cc-row-title\` + \`cc-row-sub\`, then \`cc-margin\` (a write-in margin).
- **Pencil inputs:**
  - \`cc-box\`: a tick box.
  - \`cc-check\`: a box plus its label.
  - \`cc-line\`: a full-width write-in line.
  - \`cc-blank\`: an inline blank.
  - \`cc-field\`: a label plus a line.
  - \`cc-scale\` with \`cc-scale-labels\`: a mark-the-line scale.
- **Choices to circle:** a \`cc-choices\` container holding \`cc-choice\` items (\`cc-choice-big\` for A/B/C, \`cc-choice-primary\` and \`cc-choice-quiet\` for emphasis), or \`cc-choice-tile\` tiles with a \`<small>\` hint.
- **Email:** \`cc-email\`, \`cc-email-head\` (To/Cc/Subject grid), \`cc-email-body\`.
- **Option tiles:** put \`cc-choice-tile\` tiles inside a \`cc-tiles\` grid, so they line up and fill the width.
- **Tray:** \`show_page\` adds the standard Hand-to-Duet tray at the bottom of your page automatically. Don't write one yourself.
- **Colours** (CSS variables): \`--cc-accent\` blue is Duet's ink, \`--cc-good\` green, \`--cc-warn\` rust, \`--cc-sand\`, \`--cc-paper\`.

**Copy-ready patterns:**

\`\`\`html
<main class="cc-page">
  <header class="cc-stack" style="gap:8px"><span class="cc-eyebrow">Trip · Fri 10am</span><h1 class="cc-title">Two calls to make for New York</h1><p class="cc-lede">My pick: Hotel A and the 4:05pm train.</p></header>
  <section class="cc-decision">
    <div class="cc-section-head"><h2 class="cc-h2">1 · Hotel</h2><span class="cc-hint">circle one</span></div>
    <div class="cc-tiles" data-cc-question="Hotel for Thursday night">
      <div class="cc-choice-tile" data-cc-option="Hotel A" data-cc-confirm>Hotel A · $420<small>Next to the venue</small></div>
      <div class="cc-choice-tile" data-cc-option="Hotel B" data-cc-confirm>Hotel B · $310<small>20 min away</small></div>
    </div>
  </section>
  <div class="cc-row"><span class="cc-row-time">9:30</span><span class="cc-box" data-cc-question="Call with Marcus" data-cc-option="done"></span><div class="cc-stack" style="gap:3px"><span class="cc-row-title">Call with Marcus</span><span class="cc-row-sub">Ask about option pool first.</span></div><span class="cc-margin"></span></div>
  <div class="cc-choices" data-cc-question="Send the recap?"><span class="cc-choice cc-choice-primary" data-cc-option="Send" data-cc-confirm>Send</span><span class="cc-choice" data-cc-option="Edit">Edit</span><span class="cc-choice cc-choice-quiet" data-cc-option="Hold">Hold</span></div>
  <span class="cc-field">Notes<span class="cc-line"></span></span>
</main>
\`\`\`

**Make answers machine-readable.** This is what turns Pencil marks into decisions:
- Put \`data-cc-question="Email to Priya"\` on a choice group and \`data-cc-option="Send"\` on each choice. When the person circles one, you get \`{question, choice}\` back.
- Put \`data-cc-option="done"\` (with a \`data-cc-question\` naming the item) on a tick box, so a tick reads as "done".
- Add \`data-cc-confirm\` to any option that sends, pays, books, deletes or otherwise acts outside the canvas. The answer is then flagged for you to confirm in chat before acting.
`
