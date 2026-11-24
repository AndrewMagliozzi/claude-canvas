# Build notes

This MVP was built in one unattended session on 2026-11-22/23. Below: every decision I made, what I verified and how, what's unfinished, and what can't be verified without an iPad.

## Verified (in a real browser)

All of the following were run against real Claude turns, using the system Google Chrome driven by `playwright-core`.

- `npm run test:e2e`: **all checks pass.**
  - Synthetic Pencil strokes (CDP pen events with varying force) are recorded with `isPen: true` and varying pressure (z).
  - Send → Claude replies with canvas shapes (a text margin note and an arrow), an **HTML page shape** and a **camera move**.
  - The turn includes a screenshot, structured shape data, and the user-action diff since the last turn.
  - Turn 2: marks drawn over the page come back in page-local coordinates, with the page text under them ("Ticked: Drill 1¼″ entry hole…"). Claude correctly reads which item was ticked and which was circled.
  - Claude remembers turn 1 in turn 2.
  - The canvas and chat history survive a reload.
- `node scripts/e2e-extras.mjs`: all pass.
  - One finger pans the canvas in pen mode, and a finger doesn't draw there.
  - **Stop** ends a turn in about 50ms, and the next turn works.
  - `runScript` works when enabled and is off by default.
  - **Memory survives a server restart** (the session is resumed, not replayed).
- `node scripts/smoke-https.mjs`: all pass. Over HTTPS on the LAN IP (not localhost):
  - Secure context, `webkitSpeechRecognition` present, the canvas renders (tldraw dev mode).
  - `/ca.crt` downloads, and plain HTTP redirects to HTTPS.
- `server/dev/workspace-test.mts`: with `WORKSPACE_DIR`, reading inside the folder works. Reading a file outside it, globbing with `../` or an absolute pattern, and grepping `..` are all denied.
- Session isolation: the Agent SDK `init` message reports `tools: []` and `mcp_servers: []`. Claude.ai connectors and your Claude Code MCP servers aren't loaded.
- `node scripts/security-check.mjs`: all pass.
  - Private files are never served, including encoded and `@fs/` variants: `.data/auth.json` (passcode + token secret), session ids, the CA key, `.env`, server source.
  - `/stream` and `/api/reset` return 401 without a token; the correct passcode yields a working token; repeated wrong passcodes trigger the lockout.
- **Drawing while Claude works** (extras test): a stroke made mid-turn survives, isn't tagged as Claude's, and shows up in the next turn's change list.
- **API-key fallback, dry run** (`server/dev/apikey-test.mts`): in api-key mode the child process uses `ANTHROPIC_API_KEY` (a fake key was correctly rejected as invalid); in login mode it uses the login.
- `npm start` (production build) serves the app and blocks private paths. No Claude turn was run in production mode.
- `npm run typecheck` and `npm run build` pass. The build warns about the bundle size (2.4 MB, mostly tldraw); that's harmless here.
- The exact image sent to Claude was inspected (`test-results/sent-screenshot-2.jpg`). The page renders in it, with the user's ink on top.

Typical numbers with Opus, effort low: 7–23s per turn. The first turn of a session costs about $0.25 (mostly prompt-cache creation for the ~25k-token system prompt and schema). Later turns cost $0.03–0.06. If you use a Claude subscription login, these come out of your plan's usage, not dollars.

## Claude Duet connector (V1, 2026-11-23)

**Feasibility:** yes. Duet's **Settings → Connections → Add custom connector** takes an MCP server URL over HTTPS, so the canvas exposes an MCP server and Duet stays the brain and the chat.

**What was built:**
- `server/duet/mcp.ts`: a stateless Streamable HTTP MCP server at `/mcp/<connector token>`, with tools `look_at_canvas`, `show_page`, `annotate`, `move_view` and `get_page_guide`, plus server instructions.
- `server/duet/bridge.ts` and `client/duet/bridgeClient.ts`: each open canvas holds a server-sent-events channel. The server forwards tool calls to the most recently touched canvas, which answers over POST.
- `scripts/tunnel.mjs` and `scripts/connector-url.mjs` set it up and print the URL.

**Verified** (`npm run test:duet`, all pass):
- With no canvas open, the tools say so.
- `look_at_canvas` returns a screenshot, the note text with who made it, changes since the last look, and nothing new on a second look.
- `show_page` places a page beside the notes, tagged as Duet's. `annotate` adds and deletes shapes.
- A wrong token gets 404.
- **A real Claude (Sonnet, Agent SDK) acting as Duet**, with only the connector's tools, read handwritten-style notes and put an agenda page next to them built from those notes. It used look → get_page_guide → show_page and described what it did in chat, in about 9s for $0.06.
- The canvas's own Claude is told what Duet changed.
- The main e2e and security checks still pass. The security check now also covers the bridge and connector endpoints.

**Decisions:**
- **Connector auth is a secret path token** (`/mcp/<token>`, 32 random characters, stored in `.data/auth.json`, separate from the passcode). Duet's form only takes a URL, so a header or OAuth flow wasn't an option for V1. Rotating the passcode keeps the token; `--new-connector-token` rotates it.
- **Duet uses absolute canvas coordinates** (helpers with zero offset), unaffected by the local chat's origin resetting.
- **Shapes are tagged `by: 'duet'`** (vs `'claude'` for the canvas's own assistant), so marks on pages and "made by hand" only count the person's ink.
- **Tailscale Serve for the app (private), Funnel for `/mcp` on port 8443 (public).** Funnel is per port, so a separate port keeps the app private. Vite's host check now allows `*.ts.net` and `*.local` (verified: a ts.net Host header is served, other hosts are still blocked).
- `show_page` waits about 0.9s before framing, so the page has fit its height first.

**Not verified (needs your accounts):**
- **Tailscale** isn't installed on this Mac, so `npm run tunnel` is untested. The commands follow Tailscale's documented `serve`/`funnel --https=<port> --set-path` usage; check the output on first run.
- **Duet itself:** that it accepts the connector without an OAuth step, that it renders image results from `look_at_canvas`, and how readily it calls the tools unprompted. Test by asking Duet "check my iPad" after adding the connector.
- Claude chat as a connector client (same form, same expectations).

**V2 ideas:**
- Per-client "since you last looked" tracking.
- A canvas Send mode that queues a note for Duet.
- Keep the canvas on the Mac, so Duet can work while the iPad sleeps.
- OAuth for the connector.

## Canvas-native features and the operating manual (2026-11-23)

**Three features where a canvas beats chat:**
1. **Movable boards** (`show_board`): columns or a 2×2 matrix of real tldraw cards you drag.
   - `look_at_canvas` reports where every card is, plus `cardsThePersonMoved` (once per move).
   - When Duet updates the board, your placement stays unless Duet reassigns the card.
2. **Decision sweep** (`approvals_sweep`): every pending approval on one sheet, one circle per row, then one confirmation message in chat.
3. **Redlines** (`document_markup`): `editsMarkedOnDocuments` per paragraph.
   - A strike becomes "delete these words", with the exact words read from the text at the stroke (`caretRangeFromPoint`).
   - A circle becomes "query".
   - Writing between lines becomes an insertion; writing in the margin becomes a note, with its handwriting transcribed.
   - A note's strokes are merged into one edit.

**Supporting changes:** marks are now classified (line, circle, tick, writing) and carry the exact words under them.

**Operating manual:**
- Worksheets: `operating_manual`, `preferences` and `plan`.
- Tools: `get_operating_manual` / `save_operating_manual`, with Markdown and version history in `.data/`.
- Connector instructions: read it at every check-in, and build it together on the canvas.
- The approval rule is fixed and can't be removed by the manual. A test that dropped it showed why it should be enforced.

**Verified:**
- `node scripts/e2e-powers.mjs`: board moves, the sweep with a one-message confirmation, redlines with "standard" struck in ¶2 and a "CALL" margin note on ¶3.
- `node scripts/e2e-manual.mjs`: Duet proposes rules, the person drops one and handwrites "NO CALLS", Duet saves the manual, and a new conversation follows it.
- Both run against real Claude via the fake-Duet harness.

**Testing:** `CANVAS_DATA_DIR` points tests at a scratch data folder, so they never touch your real manual or passcode.

**Renamed:** the project folder is now "Claude Canvas" (renamed on 2026-11-23). The live server must be started from the new folder.

**Not yet:**
- Dragging cards needs the arrow (select) tool on the iPad, because the Pencil draws in the draw tool.
- Card moves are read by card centre.

## Handwriting transcription (2026-11-23)

**How it works:**
- On each `look_at_canvas`, the canvas groups the ink you added since Duet last looked into patches: strokes within 70px of each other. It renders each patch large, ink only on white (up to 8 patches).
- The Mac transcribes them in one tool-less Claude call through your login (`server/duet/transcribe.ts`, Sonnet by default). Results are cached by image.
- Duet receives `newHandwriting: [{where, text, confidence, bounds, shapeIds}]`, plus up to four close-ups to check against. `where` names the tray or page, using the existing mark data.
- Drawings, ticks and circles are described in brackets rather than "read" as words.

**Verified** (`node scripts/e2e-handwriting.mjs`, all pass): simulated Pencil block capitals "CALL ANNA" in a tray came back as "CALL ANNA", confidence high, located in the Hand-to-Duet tray, with the whole look taking 2.3s. The same ink isn't reported twice.

**Not verified:** real cursive from a real Pencil. Transcription quality will depend on your handwriting; the close-up images are always sent, so Duet can check its own reading.

**Privacy:** the crops go to Anthropic through your Claude Code login, the same way the canvas's own Claude turns do. `HANDWRITING_TRANSCRIPTION=off` disables it, leaving Duet with the images only.

## Templates and chief-of-staff mode (2026-11-23)

**What was built:**
- `shared/canvasKit.ts`: the design kit stylesheet, injected into every page. It also has the Hand-to-Duet tray and a compact reference for Claude.
- `server/duet/templates.ts`: six data-driven templates, matching the designs in the Claude Canvas Templates artifact.
- `show_template`: validates the data and returns field lists when something's missing.
- `show_page`: now adds the tray automatically.
- Chief-of-staff instructions in the connector: prepare without being asked, show decisions rather than data, design new templates when none fit, and always ask explicitly in chat before outward actions.

**Answers from the Pencil:**
- Choices carry `data-cc-question` / `data-cc-option`, and outward actions also carry `data-cc-confirm`.
- The page's hit test reports which option a mark selects: the option whose centre is nearest the mark's centre. It also reports the region the mark is in, e.g. `tray`.
- `look_at_canvas` returns `answersMarkedOnPages` and `newRequestsInTrays`, each flagged `isNew` only the first time.

**Verified** (`node scripts/e2e-templates.mjs`, all pass):
- A simulated Pencil circle around "Send with edits" comes back as the answer to "Email to Priya: …", flagged as acting outside the canvas.
- Writing in the tray comes back as a new request.
- A fake Duet (Sonnet, connector tools only):
  - asked explicitly before sending, and noticed there were no actual edits;
  - used `daily_brief` when given a calendar;
  - designed a kit-styled trip page with machine-readable choices when no template fit.

**Limits:**
- Handwriting itself is still read from the screenshot. The canvas tells Duet *where* you wrote, not the words.
- A circle that spans two options picks the nearer one.

## Decisions

### Architecture
1. **One Node process** (`server/index.ts`) runs Vite in middleware mode plus the API, so `npm run dev` is a single command with a single port. The kit's Cloudflare worker, Durable Object and `wrangler` are gone. So are the Vercel AI SDK providers and the Google/OpenAI keys.
2. **Claude via the Agent SDK** (`@anthropic-ai/claude-agent-sdk`). It spawns the Claude Code CLI and uses your existing Claude Code login (verified: `apiKeySource: none`, i.e. OAuth). I chose it over shelling out to `claude -p` because it supports streaming input, image content blocks, interrupts and `resume` natively.
3. **One long-lived streaming-input session per conversation.** The prompt is an async queue; each Send pushes one user message. Benefits: real conversation memory, a warm process and prompt cache, and `interrupt()` for Stop without killing the session.
   - The browser generates a `conversationId` (persisted with the canvas). The server maps it to a Claude session id in `.data/sessions.json`, so a restart **resumes**.
   - If a resume fails, the server starts fresh and replays the kit's chat-history part for that turn.
   - "New" in the drawer resets the conversation id and drops the server session.
4. **Chat history isn't re-sent while the session remembers.** The kit sends the full chat history every request. With a live or resumed session I skip that part (`skipChatHistory`), so history isn't sent twice.
5. **Auth order:** the login comes first. `ANTHROPIC_API_KEY` is stripped from the child's environment (Claude Code would otherwise prefer it). The key is only used if a turn fails with an auth-looking error and a key is set.
6. **Isolation:**
   - `tools: []`, `settingSources: []`, `strictMcpConfig: true` with no MCP servers, and an empty working folder (`.data/claude-cwd`).
   - A `canUseTool` callback denies everything except Read/Glob/Grep inside `WORKSPACE_DIR` (realpath-checked).
   - Variables from a parent Claude Code session (`CLAUDECODE`, `CLAUDE_CODE_SESSION_*`, `CLAUDE_EFFORT`, …) are stripped, so starting the server from inside Claude Code doesn't confuse the child.
7. **Env var names:** I used `CANVAS_MODEL` and `CANVAS_EFFORT` rather than `CLAUDE_MODEL` and `CLAUDE_EFFORT`. I found `CLAUDE_EFFORT` already set in the environment by Claude Code, and it silently changed behaviour.
8. **Output format:** Claude still answers in the kit's JSON format (`{"actions":[…]}`), parsed incrementally while it streams. I didn't use tool calls or structured outputs, because those would lose the live, action-by-action streaming the kit is built around.
   - The parser was rewritten. It handles escapes correctly in HTML/JS payloads, ignores a trailing code fence, and **drops stray closing brackets**. That last one fixed a real intermittent bug: one stray `}` from the model made every later action (the page and camera) silently disappear.
9. **Defaults:** model `opus`, effort `low`, adaptive thinking. Opus produces much better pages, and with effort low turns still take about 7–23s. Switch to `sonnet` in the drawer for speed.

### Fixes from the code review (2026-11-23)
- After a Stop or error, unlocking Claude's half-streamed shapes was recorded as *your* edit. The unlock now runs as the agent, and change entries with no visible difference are dropped.
- Glob/Grep patterns with braces or extglobs (`{..,x}`, `{/Users,x}`) could slip past the `WORKSPACE_DIR` check. Any `..`, any leading `/` or `~`, and any brace or extglob syntax are now rejected.
- Private-path blocking is anchored to the project root, so a parent or dependency folder named `server` or `certs` no longer breaks the app. `/ca.pem` works again.
- The production static handler checks `dist/` with a trailing separator, so a sibling folder like `dist-old/` can't be served.
- If a request fails before reaching the server (401, network), your canvas changes are put back for the next try instead of being lost.
- **Root cause of the intermittent "page and camera missing" failure:** Claude sometimes writes a reply, then "Actually… Redo:" and a second full JSON object. The parser stopped at the end of the first. It now reads further documents too, skipping creates of shapes an earlier document already made, and the prompt asks for exactly one object.
- Models sometimes emit a shape as an action (`{"_type":"text",…}`). These are now turned into `create` actions rather than silently dropped (seen once with Sonnet).
- A turn sent right after Stop waits for the interrupted turn to finish, so it knows the session already remembers the conversation and doesn't replay history.
- Test scripts were made more robust: a unique token for the outside-file check, the mid-turn stroke looked for in all later requests, and the security check kills its own server.

### Fixes from the full code review of the starter kit (2026-11-23)
The review covered the kit code this project builds on. Fixed:
- **An error inside an action could crash the whole canvas.** tldraw treats an error inside a batch as a crash. Sanitizing and applying each action, both in the local loop and in Duet's bridge, now catches its own errors, skips that action, and tells Claude.
- **Updating a freehand drawing erased its stroke** (e.g. "make my drawing red"). The update now keeps segments, pen pressure and size.
- **Updating a multi-point line collapsed it to one segment.** It's kept whole when its endpoints don't move.
- **Arrow labels always looked empty** to Claude and Duet, and edits could wipe them. They're now read from the label text.
- **Arrows couldn't be detached, and recolors re-aimed them.** Bindings are replaced only when the update changes what the arrow connects to.
- **Stopping mid-action left a half-built, locked shape.** It's now removed on every exit path.
- **Partially streamed shape ids could permanently remap later references.** Renames are only remembered for complete actions, and mapped ids are checked to exist.
- **Rejecting a group of changes in the chat history could re-create shapes.** Diffs are now undone newest-first.
- **Resize and rotate ignored pivots at 0.**
- **Rounding was un-done in the wrong direction**, so shapes drifted by up to 1px.
- **Pen strokes ended one point short.**
- **Stacking with gap 0 did nothing.**
- **The "solid" fill turned users' fills into lined fills.**
- **Prompt-building errors failed silently.**
- **Enter while composing an IME candidate could send.**
- **Packaging:** `tsx` is now a runtime dependency, so `npm start` works; `.env.*` is git-ignored.

Not applicable here (those features aren't in this build): the todo-list retry loop and the country-info restart.

**Not fixed (documented):** shapes inside frames or groups are positioned in page space while tldraw stores them relative to their parent, so editing a child of a frame can move it. Claude rarely makes frames here, but a user-made frame would hit this. It's the next fix if it shows up.

### Turns and UI
10. **Send is the only way a turn starts.** Return in the text box adds a newline; ⌘/Ctrl+↩ also sends. There's no auto-send on pauses or on dictation ending.
11. **The kit's automatic lint follow-up is disabled.** After a reply, the kit scheduled an extra round trip whenever its linter flagged something, such as an arrow pointing at a drawing. That doubled some turns and blurred "Claude's turn has ended". Lints still go in the next real turn. The kit's own `review` and `setMyView` actions remain available, but the prompt discourages them.
12. **The drawer overlays the canvas** rather than shrinking it. While it's open, the visible bounds and the camera's "safe area" exclude it.
13. **Camera framing** fits replies into a safe area. That area excludes tldraw's style panel, the toolbar, the Send button and the drawer. Claude is also told that safe area is "what the user can see". Before this fix, replies sat under the style panel.
14. **Screenshots** render at about screen resolution (capped at 1568px on the long edge) instead of 1 px per canvas unit, so handwriting stays legible. If rendering pages fails, the screenshot retries without them rather than failing the turn.
15. **Status line:** server-sent progress (`Thinking…`, `Writing…`), then each action's description as it applies, plus elapsed seconds and Stop.
16. **The default tool is draw** (Pencil-first). In pen mode, one-finger drags pan; tldraw already ignores touch for tools and handles two-finger pinch.
17. **One bad action no longer ends the turn.** The kit rethrew errors from `act()`. Now the action is skipped and Claude gets a note about it next turn.
- **Fixed a kit behaviour: change history was wiped at the end of every turn.** The kit cleared the user-change history whenever the agent went idle, so edits you made between turns never reached Claude. It now accumulates until the next request is built.
18. **Shapes Claude creates are tagged** with `meta.by = 'claude'`. That lets later turns separate "the person's marks" from "Claude's marks": which marks sit on a page, and which shapes in view are handwritten.

### HTML page shape
19. The `html-page` custom shape uses an iframe with `srcDoc` and `sandbox="allow-scripts"` (no `allow-same-origin`).
   - The iframe ignores pointer events unless the page is in editing mode (double-tap). So the Pencil draws on top of pages, and you can still use page JS when you want to.
20. A small **bootstrap script** is injected into every page and talks to the canvas over `postMessage`:
   - It reports content size, which drives auto-height until the page is resized by hand.
   - It reports script errors to Claude next turn.
   - It answers **snapshot** requests by serializing its live DOM, with canvases inlined as images. Screenshots and exports then show the page as it currently looks, including JS-rendered content.
   - It answers **hit-test** requests ("what text is under these boxes?"), so Claude knows which words you circled or ticked.
21. **Page export:** a page renders as an isolated nested SVG image (a `data:` URL with `foreignObject`), so its CSS can't leak into the rest of the export.
22. **History previews:** the pages shown in the chat drawer's history are static (no scripts) and don't register with the bridge. Before this fix, the preview hijacked the real page's hit tests.
23. **No external resources:** the guide tells Claude to avoid web fonts, CDNs and remote images. They wouldn't appear in screenshots, and the pages should work offline.
24. Claude replaces a page by sending `page` again with the same id. Pages can be moved, resized and deleted like any shape (they're in the Focused-shape format as `htmlPage`).

### Safety
- **Fixed during review: secrets were readable over the LAN.** Vite serves any file under the project root, so `/.data/auth.json` (passcode and token secret) was downloadable by anyone on the Wi-Fi.
  - The server now 404s private paths (`.data`, `certs`, `.env*`, `server/`, `.git`, `*.pem`, with URL decoding) before Vite sees them, and Vite's `fs.deny` lists them too. `scripts/security-check.mjs` guards this.
  - **The passcode was rotated** after the fix. The new one is printed when you run `npm run dev`.
- **Fixed during review: Glob/Grep patterns could escape `WORKSPACE_DIR`.** The permission check only looked at path fields. Patterns that are absolute or contain `..` are now rejected.
- **In HTTPS mode, the plain HTTP port serves only `/ca.crt`** and redirects everything else, so the passcode and turns never travel in cleartext there.
25. **Passcode:** six digits, generated once and persisted in `.data/auth.json` (mode 600), printed at startup. I persisted it so the iPad doesn't have to re-enter it after every restart. `--new-passcode` rotates it, and `PASSCODE=` overrides it.
   - The browser exchanges the passcode for an HMAC token. The server checks it on `/stream` and `/api/reset`.
   - There's a 30-second lockout after 5 wrong attempts per address.
   - The passcode is a LAN-level gate, not strong auth, and plain HTTP can be sniffed on your Wi-Fi. Use `dev:https` if that matters.
26. **The script action is gated by an environment variable** (`ENABLE_SCRIPT_ACTION=1`) rather than a UI toggle, so a device holding the passcode can't turn it on. It's filtered out of the schema in the browser and again on the server, and the browser refuses to run it unless the server's config says it's enabled.
27. **HTTPS:** `npm run certs` creates a local CA and server certificate with openssl. No mkcert, nothing installed globally, and nothing added to the Mac keychain (documented as an optional manual step). The certificate lasts 800 days, because Apple requires at most 825. The CA is served at `/ca.crt` on the plain HTTP port for easy iPad install.
28. **tldraw license:** a `TLDRAW_LICENSE_KEY` environment variable is passed through to `licenseKey`. I read tldraw's `LicenseManager` source to confirm that the dev server counts as development even over HTTPS on a LAN IP; the HTTPS smoke test confirms the canvas renders there. The license check isn't patched.

### Prompting
29. New intro section: it frames the turn-based canvas conversation and says the reply lives on the canvas (`message` is only a short aside, because the drawer is often closed). It also says to read handwriting as speech, never cover the person's marks, and finish with a camera move.
30. `PAGE_GUIDE.md` is drafted from your principles. I tested it with `scripts/guide-trial.mjs` on six prompts (handwritten sum, fractions practice, a travel comparison, a heat-pump explainer, new-job nerves, a camping checklist) and made changes based on what came out:
   - Letters must be prose with at most one list (the first trial turned "advice" into a checklist).
   - Page height must fit the unobstructed view, and I added a "cut ruthlessly" rule (pages ran under the toolbar).
   - Checkboxes are drawn, not `<input>`s, so the Pencil can tick them.
   The results were good: a margin note for the handwritten sum, a worksheet with write-in boxes, a table ending in "Circle one", and a labelled SVG diagram.
31. Each turn carries a `[TURN]` line: the current page, the other pages, which shapes in view are handwritten, and, if you typed nothing, "your message is what you drew". Self-scheduled follow-ups are labelled `[CONTINUATION]`.

### Things removed from the kit
32. I removed the kit's todo list, `add-detail`, `countryInfo`, `count` and `clear` actions, which don't fit this product (`clear` would delete your work). Their schema files remain but aren't offered. The model list is replaced with Claude Code aliases.

## Unfinished and known limitations

- **No real iPad testing** (see below). Everything is verified in desktop Chrome with synthetic pen and touch events.
- **Safari/WebKit wasn't tested.** Playwright's WebKit build isn't installed, and I didn't want to download browsers outside the project. The parts most at risk in Safari:
  - Rasterizing page snapshots (nested SVG + `foreignObject`). There's a fallback: the screenshot omits pages, but marks and hit-test text still reach Claude.
  - Web Speech in iPadOS Safari.
  - Pointer-event quirks.
- **`setMyView` and `review` are lightly tested.** Both make the kit re-prompt automatically, so they cost an extra round trip. They're available but discouraged in the prompt.
- **Debug globals:** `window.editor`, `window.agent`, `window.__pageBridge`, `window.__tldraw_b64` and `window.__toRichText` are exposed for the tests and for debugging in the console. They're harmless on a passcode-gated LAN app, but remove them before exposing this more widely.
- **The API-key fallback after a real login failure is unverified.** I couldn't log out to test it. It triggers when a turn fails before any output with an error matching `/auth|log ?in|credential|401|api key|oauth|unauthorized|not logged/i`. If Claude Code reports a logged-out state differently, the fallback won't kick in. Workaround: set the key and run `claude logout`, or edit `AUTH_ERROR` in `server/claude/SessionManager.ts`.
- **Canvas isn't shared across devices.** It's stored per browser (IndexedDB). The Mac and the iPad each have their own canvas, but they share a Claude conversation only if they share a conversation id, which they don't by default. Server-side canvas persistence or tldraw sync would fix this.
- **Long sessions:** each turn adds a screenshot to the Claude transcript. Claude Code's auto-compaction should handle very long conversations, but I didn't test it. "New" starts fresh.
- **Hit tests** only see text under a mark's bounding box, sampled on a 5×5 grid, and only for pages that aren't scrolled. Marks on canvas shapes (not pages) rely on the screenshot and the shape diff.
- **Auto-height** changes are applied as "remote" changes, so they aren't reported to Claude as your edits. Side effect: the changes aren't persisted; pages re-fit on load.
- **Bundle size** is 2.4 MB (tldraw). Fine on a LAN.
- **No cost or turn caps** beyond Claude Code's own limits. There's no per-turn budget setting yet (the Agent SDK supports `maxBudgetUsd` if wanted).

## Needs an iPad to verify

- **Apple Pencil pressure on real hardware.** Synthetic `pointerType: 'pen'` events with varying force produced `isPen: true` strokes with varying pressure, which is tldraw's documented path.
- **Pen mode turning on with a real Pencil.** tldraw only enables it automatically for direct-display pens (`isPenDirect`). In the test I forced pen mode on to check one-finger panning.
- **Finger gestures:** one-finger pan alongside tldraw's own two-finger pinch on iPadOS. The handoff from one finger to two is the delicate part.
- **Palm rejection** while writing, and whether double-tap-to-interact with a page feels right on touch.
- **Safari speech recognition** over HTTPS: the permission prompt, accuracy, and that it stops cleanly.
- **The certificate install flow** on current iPadOS: profile download, install, then Certificate Trust Settings.
- **Layout:** safe areas and the Home Screen web-app mode, Send button placement versus the iPad's tldraw toolbar at different orientations, and the drawer width at 11″ versus 13″.
- **Performance** of many live page iframes on iPad memory.

## Demo video (Nov 23)
- `scripts/demo-video.mjs` records the canvas live in headless Chrome, using a CDP screencast. Playwright recordVideo left a grey band. The script then encodes H.264 yuv420p at 1080p.
- The canvas, its templates, the Pencil strokes and the connector calls are real. Duet's chat lines are scripted and labelled "illustrative". A real look_at_canvas runs alongside and is logged; it read back all 5 circled answers and "CALL ANNA".
- All names and data are fictional. Nothing is sent to external video or voice services. The video is committed in `demo/` (2.4 MB). Before the code went public, test fixtures were changed to fictional names.
