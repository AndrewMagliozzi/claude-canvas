# Claude Canvas

A canvas where you talk with Claude by drawing, typing or speaking, and Claude answers by taking over the canvas. It draws, writes, lays out rich pages and moves your view.

It works like Claude Code's turn-based loop, except the "terminal" is a [tldraw](https://tldraw.dev) canvas on your iPad and Claude can render anything, not just text.

- **Your turn:** draw or handwrite with the Apple Pencil, type in the chat drawer, or dictate with the mic. Your turn ends only when you press **Send**.
- **Claude's turn:** Claude sees a screenshot of your view, the shapes on the canvas, what you changed since its last turn, and your text. It replies with canvas actions: shapes, pen strokes, notes and arrows beside your handwriting, HTML "pages", laser-pointer sweeps and camera moves. A status line shows what it's doing, with a **Stop** button. You can keep drawing meanwhile.

Everything runs on your Mac. The iPad is just a browser on your home Wi-Fi. There's no cloud hosting.

Built from the tldraw Agent starter kit. Its Cloudflare worker is replaced by a small local Node server that talks to Claude through your Claude Code login, using the [Claude Agent SDK](https://platform.claude.com/docs/en/agent-sdk/overview).

**Demo (1 min):** [demo/claude-canvas-demo.mp4](demo/claude-canvas-demo.mp4). The canvas, the Pencil strokes and the connector calls are recorded live. The Duet chat beside them is illustrative, and the names are fictional. Rebuild it with `npm run demo:video`.

## Requirements

- macOS with Node.js 20.12+ (tested with Node 22).
- Claude Code installed and logged in (run `claude` once and log in). The server uses that login. If `ANTHROPIC_API_KEY` is set, it's used only as a fallback when the login fails.
- An iPad on the same Wi-Fi network as the Mac.

## Run it

```sh
npm install
npm run dev
```

The terminal prints something like:

```
  Claude Canvas is running

  On this Mac:    http://localhost:5173
  On your iPad:   http://192.168.1.23:5173
  Passcode:       482913
  Claude auth:    Claude Code login
  Model:          opus (effort: low)
  File tools:     off
  Script action:  off
```

Open the **On your iPad** URL in Safari and enter the **passcode**. The passcode is stored in `.data/auth.json` so it survives restarts. To rotate it (which also signs out every device), run `npm run dev -- --new-passcode`. To pick your own, set `PASSCODE=...`.

`npm run dev` is the only command you need. A single Node process serves the app (via Vite, with hot reload), the API, and the Claude sessions.

### Using it on the iPad

- **Pencil draws, fingers move the canvas.** The first time tldraw sees the Pencil, it switches to pen mode. From then on, one finger pans and two fingers pinch-zoom; fingers never draw. Stroke pressure is recorded from the Pencil.
- **Send** (the orange button, bottom right) ends your turn. It sends whatever is in the chat box along with the canvas. You can also press Send with an empty box, and Claude will respond to what you drew. Nothing is ever sent automatically.
- **Chat drawer** (the speech-bubble button) slides in from the right. It holds the turn history, the text box, the mic button, the model picker and **New** (start a new conversation; the canvas stays). In the text box, Return adds a new line; ⌘↩ sends.
- **Pages** that Claude composes are live HTML. Draw on them freely; Claude gets your marks next turn, along with the page text under each mark. Double-tap a page to interact with its buttons and scripts; tap outside it to go back to drawing.
- **Add to Home Screen** from Safari's share menu gives you a full-screen app.

The canvas is saved in the iPad browser's local storage (IndexedDB), so it survives reloads. The conversation memory lives on the Mac (see [How it works](#how-it-works)). Each browser has its own canvas, so the Mac and the iPad don't share one.

## Use it with Claude Duet, Claude chat or Claude Code (connector)

The canvas can also be a **whiteboard for another Claude**. Claude Duet stays the brain and the chat. The canvas's connector lets it read what you wrote with the Pencil and put pages, notes and drawings on your iPad. It's a standard MCP server, so Claude chat (claude.ai, desktop, mobile) and Claude Code can use it too.

| Tool | What the connected Claude can do |
|---|---|
| `look_at_canvas` | See a transcription of everything you wrote since it last looked (with a sharp close-up of each patch), a screenshot of your view, the shapes in it, what you changed since it last looked, your marks on its pages (with the text under them), and what you discussed with the canvas's own Claude. |
| `show_template` | Put a ready-made page on the canvas, filled with real data: `daily_brief`, `meeting_agenda`, `email_draft`, `decision_memo`, `inbox_triage` or `weekly_review`. |
| `show_page` | Put a page of its own design on the canvas (built from the design kit), in open space in your view, and move your view to it. |
| `annotate` | Add margin notes, sticky notes, arrows, pen strokes (ticks, circles), simple shapes or a laser sweep; move or delete its own marks. |
| `move_view` | Move your iPad's view to some shapes or a region. |
| `get_page_guide` | Read `PAGE_GUIDE.md`, so its pages follow the same design rules. |

**Templates, answers and requests.**
- Every page shares one design kit (`shared/canvasKit.ts`): paper look, tick boxes, write-in lines, circle-one choices, and a **Hand to Duet** tray at the bottom.
- When you circle or tick a choice, `look_at_canvas` reports it as an answer, e.g. *"Email to Priya → Send with edits"*. Writing in a tray comes back as a new request.
- Anything that sends, pays, books or deletes is flagged. Duet is instructed to ask you explicitly in chat before doing it.
- The designs live in the [Claude Canvas Templates](https://claude.ai/artifact/T9tdY13cVcdBHMuhBArjuR) artifact.

**Operating manual.** You and Duet agree how it works for you on the canvas:
- **Worksheets:** `operating_manual` (circle Keep / Change / Drop on proposed rules, and write your own), `preferences` (circle-one questions) and `plan` (goals, key results, a confidence line, and what Duet does for each).
- **Saving:** Duet folds your marks into a Markdown manual, saved on your Mac in `.data/operating-manual.md` with every earlier version in `.data/operating-manual-history/`. It reads the manual at the start of every check-in.
- **Fixed rule:** explicit approval in chat before sending, paying, booking or deleting always applies. The manual can't turn it off.

**Suggested Duet rule** (Settings → Rules): *"When I mention my iPad or canvas, and at every check-in, call look_at_canvas. Treat new writing in a Hand-to-Duet tray, and new circled or ticked answers, as requests from me. Prepare them, show me the result on the canvas, and ask me explicitly in chat before sending, paying, booking or deleting anything."*

**How you use it with Duet:** write or sketch on the iPad, then tell Duet (by voice or text) "check my iPad". Duet looks, acts, and replies in its own chat. It may also put things on the canvas on its own, such as an agenda for a call. The canvas page must be open on the iPad (Safari or the Home Screen app) for Duet to see or draw. If it isn't, Duet is told the canvas isn't open.

### Claude Code (this Mac, no tunnel)

```sh
npm run connector-url   # prints the exact command, e.g.:
claude mcp add --transport http canvas http://localhost:5173/mcp/<token>
```

### Claude Duet and Claude chat (needs Tailscale)

These run in Anthropic's cloud, so they need a public HTTPS address for the connector. [Tailscale](https://tailscale.com) provides one while keeping the app itself private:

1. Install Tailscale on the Mac and the iPad (free; [tailscale.com/download](https://tailscale.com/download)) and sign in to the same account on both.
2. With `npm run dev` running, run:

   ```sh
   npm run tunnel
   ```

   This sets up:
   - **Tailscale Serve (private):** the whole app at `https://<your-mac>.<tailnet>.ts.net:8443`, reachable only from your own devices. It has a real certificate, so **the iPad's mic works with no certificate setup**. Use this address on the iPad from now on, at home or away.
   - **Tailscale Funnel (public):** only `/mcp` on the standard HTTPS port (443). Funnel works per port, so the public port carries nothing but the connector, and the app lives on 8443. Cloud services such as Duet may refuse non-standard ports, which is why the connector is on 443. Everything else on that port returns 404, and the connector itself requires its secret token.

   The first time, Tailscale may ask you to enable HTTPS certificates and Funnel for your tailnet. Follow the link it prints, then run `npm run tunnel` again.
3. Copy the connector URL it prints (`https://<your-mac>.<tailnet>.ts.net/mcp/<token>`). In Claude Duet, go to **Settings → Connections → Add custom connector**, give it a name (e.g. "iPad canvas"), paste the URL, and press **Continue**. On the next screen, choose **Authentication → No sign-in** and add no request headers: the secret in the URL is the key. Claude chat has the same form under **Settings → Connectors**.

**Security:**
- The public surface is the five canvas tools above. Anyone with the connector URL can see and draw on your canvas, so keep it secret.
- The connector has no access to files, your shell, the passcode, or the canvas's own Claude.
- Rotate the URL with `npm run dev -- --new-connector-token` (then update it in Duet). Turn the public part off with `npm run tunnel -- off`.

**V1 limits:**
- Duet can't start a turn from the canvas. You prompt it in Duet, or it checks on its own schedule.
- "What changed since you last looked" is shared by all connected Claudes, so whichever looks first gets your new marks.
- If both the Mac and the iPad have the canvas open, the connector uses the one you touched most recently.

## Voice input and HTTPS

Safari only allows the microphone, and therefore speech recognition, on secure pages. Over plain `http://192.168.x.x` the mic button is greyed out and explains why; everything else works without HTTPS.

**Easiest:** if you set up Tailscale for the connector (above), open the `https://<your-mac>.<tailnet>.ts.net:8443` address on the iPad, and voice just works. Otherwise, use a local certificate:

1. **Create certificates** (once, on the Mac):

   ```sh
   npm run certs
   ```

   This creates a local certificate authority (CA) and a certificate for `localhost`, your Mac's `.local` name and its current LAN IP, all in `certs/`. Nothing is installed globally.

2. **Start in HTTPS mode:**

   ```sh
   npm run dev:https
   ```

   The app is then served at `https://<mac-ip>:5443`. Port 5173 stays plain HTTP: it serves only the CA certificate and redirects everything else to HTTPS.

3. **Trust the CA on the iPad** (once):
   1. In Safari on the iPad, open `http://<mac-ip>:5173/ca.crt`. The URL is printed at startup. Tap **Allow** to download the configuration profile.
   2. Open **Settings → General → VPN & Device Management** (or tap "Profile Downloaded" at the top of Settings), select **Claude Canvas Local CA**, and tap **Install**.
   3. Open **Settings → General → About → Certificate Trust Settings** and turn on full trust for **Claude Canvas Local CA**.

4. Open `https://<mac-ip>:5443` on the iPad, tap the mic, and allow microphone access.

Optional: to avoid the browser warning on the Mac, add `certs/rootCA.pem` to Keychain Access → System and mark it **Always Trust**. That's a system-wide change, so it's left to you.

If the Mac's IP address changes, run `npm run certs` again. The CA stays the same, so the iPad doesn't need to re-trust it. Keep `certs/rootCA-key.pem` private: anyone with that key can create certificates your iPad would trust. To undo everything, delete the profile on the iPad and the `certs/` folder.

Dictation uses Safari's built-in speech recognition (Apple's speech service, which may process audio on Apple's servers). It only fills the chat box; you still press Send.

## Settings

Set these in the environment or in a `.env` file in the project root.

| Variable | Default | What it does |
|---|---|---|
| `CANVAS_MODEL` | `opus` | Model for new turns: `opus`, `sonnet`, `haiku` or a full model id. The drawer's model picker overrides it per browser. |
| `CANVAS_EFFORT` | `low` | Thinking effort: `low`, `medium`, `high`, `xhigh` or `max`. Higher is slower and more thorough. |
| `PORT` / `HTTPS_PORT` | `5173` / `5443` | Ports. |
| `HOST` | `0.0.0.0` | Bind address. Use `127.0.0.1` to allow only this Mac. |
| `PASSCODE` | generated | Fixed passcode instead of the generated one. |
| `ANTHROPIC_API_KEY` | – | Fallback if the Claude Code login fails. |
| `WORKSPACE_DIR` | off | Gives Claude **read-only** Read/Glob/Grep tools inside this one folder. |
| `ENABLE_SCRIPT_ACTION` | off | Enables the script escape hatch (see below). |
| `TLDRAW_LICENSE_KEY` | – | tldraw license key (see [License](#tldraw-license)). |
| `HANDWRITING_TRANSCRIPTION` | on | Transcribe new handwriting for the connector with Claude on this Mac (your login). `off` to disable. |
| `CANVAS_TRANSCRIBE_MODEL` | `sonnet` | Model used for handwriting transcription. |
| `DEBUG_CLAUDE` | off | Logs prompts and raw model output to the terminal. |

### File access (`WORKSPACE_DIR`)

By default Claude gets canvas actions only: no shell, and no access to files on the Mac. Each Claude session runs with no built-in tools and none of your Claude Code settings (no hooks, MCP servers or CLAUDE.md), in an empty working folder (`.data/claude-cwd`).

With `WORKSPACE_DIR=/path/to/folder`, Claude also gets `Read`, `Glob` and `Grep`. A permission check confines every path to that folder, resolving symlinks. Writes, shell commands and web access stay off.

### Script action (`ENABLE_SCRIPT_ACTION=1`): read the risks

This adds a `runScript` action: Claude writes JavaScript, and your browser runs it against the tldraw `editor` API. Use it for things the typed actions don't cover. It's off by default. When it's off, the action isn't offered to Claude, and the browser refuses to run it even if asked.

**Risk:** the script runs with the full privileges of the app's page in your browser. It can read and change everything on your canvas, read the app's stored passcode token, and make network requests from your browser (for example to other devices on your LAN). It can't touch the Mac's files or shell directly. A prompt-injected Claude (for example, one reading a hostile page or file you pasted in) could misuse this. Turn it on only when you need it.

## tldraw license

The tldraw SDK needs a license key in production. This project runs tldraw in **development mode** (the Vite dev server), which works without a key and shows the "Get a license for production" link. The license check is not bypassed or patched.

If you have a key, set `TLDRAW_LICENSE_KEY=...` and it's passed to `<Tldraw licenseKey>`.

- `npm run dev` and `npm run dev:https` (the voice path) run in development mode and need no key.
- A production build (`npm run build && npm start`) over plain HTTP also passes tldraw's development check, which treats any `http:` origin as development.
- A production build served over **HTTPS** on a LAN IP counts as production and needs a key. Use `dev:https` for voice instead.

Don't deploy this anywhere public without a proper license; see [tldraw.dev/pricing](https://tldraw.dev/pricing).

## How it works

```
iPad Safari ──HTTP(S)──▶ Node server on the Mac (server/index.ts)
  tldraw canvas            ├─ Vite (serves the React app)
  agent kit (client/)      ├─ /api/auth, /api/config, /api/reset
                           └─ /stream ──▶ Claude Agent SDK ──▶ Claude Code login
                                         (one long-lived session per conversation)
```

- **Client** (`client/`): the tldraw Agent starter kit, extended. On Send it gathers the prompt parts: screenshot, shape data, changes since the last turn, marks on pages, text. It then streams back actions and applies them in order. Camera moves, pauses and laser sweeps finish before the next action starts, so Claude can choreograph a turn.
- **Server** (`server/`): builds the system prompt (the kit's rules, the canvas-conversation rules, `PAGE_GUIDE.md` and the action JSON schema). It keeps one **Agent SDK streaming-input session per conversation**, which holds a Claude Code process and its prompt cache warm between turns. Images go in as base64 image blocks. Session ids are saved in `.data/sessions.json`, so after a server restart the next turn **resumes** the same Claude conversation. If a session can't be resumed, the turn replays the chat history instead. Claude's JSON reply is parsed while it streams (tolerating minor JSON slips) and sent to the browser as server-sent events.
- **Turns are serialized.** If you press Send while Claude is still working, the current turn is interrupted, not the session, and the new one starts after it.

### Actions Claude can take

The kit's actions: `create`, `update`, `delete`, `move`, `label`, `place`, `align`, `distribute`, `stack`, `resize`, `rotate`, `bringToFront`, `sendToBack`, `pen` (freehand strokes), `think`, `message`, `review`, `setMyView`. Plus these:

| Action | What it does |
|---|---|
| `page` | Creates or replaces an HTML page shape: arbitrary HTML/CSS/JS/SVG in a sandboxed iframe (`allow-scripts`, no same-origin). It auto-fits its height. |
| `camera` | Moves *your* view to a region or to shapes, animated, and waits for the move to finish. |
| `point` | A fading laser-pointer sweep ("look here"). |
| `pause` | A short wait between steps. |
| `switchPage` | Switches to, or creates, a tldraw page. |
| `group` / `ungroup` | Groups or ungroups shapes. |
| `runScript` | The escape hatch (off by default; see above). |

### The page guide

[`PAGE_GUIDE.md`](PAGE_GUIDE.md) is loaded into Claude's system prompt. It tells Claude how to choose the form of a reply (margin note, letter, worksheet, checklist, diagram, map, timeline, decision tree, index card, front page) and how to lay it out for a Pencil. Edit it freely: it's re-read when it changes, and the next turn picks it up.

## Scripts

| Command | |
|---|---|
| `npm run dev` | Start everything (HTTP). |
| `npm run dev:https` | Start with HTTPS (needed for voice). |
| `npm run certs` | Create the local CA and HTTPS certificate. |
| `npm run typecheck` | TypeScript check. |
| `npm run build` | Typecheck and production build to `dist/`. `npm start` serves it. |
| `node scripts/security-check.mjs` | Checks that private files (passcode, keys, `.env`) are never served, and that the API requires the token. |
| `npm run connector-url` | Prints the connector URL / Claude Code command. |
| `npm run tunnel` | Sets up Tailscale: app private, connector public (`npm run tunnel -- off` to undo). |
| `npm run test:duet` | Connector end-to-end test: direct MCP calls, plus a real Claude using only the connector (playing Duet) that reads handwritten notes and puts an agenda page beside them. |
| `npm run test:e2e` | End-to-end test in Chrome. It draws a synthetic Pencil sketch, sends it, and checks that Claude replies with shapes, a page and a camera move. Then it marks up the page and checks memory and persistence. It uses real Claude turns. |
| `node scripts/e2e-extras.mjs` | Tests Stop, one-finger pan in pen mode, the script action, and memory across a server restart. |
| `node scripts/smoke-https.mjs` | HTTPS smoke test on the LAN IP. |
| `node scripts/guide-trial.mjs` | Runs sample prompts and screenshots the replies (for tuning `PAGE_GUIDE.md`). |
| `npm run demo:video` | Records the ~1-minute demo to `demo/claude-canvas-demo.mp4`: the real canvas with scripted Pencil strokes, an illustrative Duet chat beside it, and captions. It uses its own server and a throwaway data folder, and needs ffmpeg. |

Test artifacts (screenshots, including the exact image sent to Claude) go to `test-results/`.

## Files

- `client/`: the browser app. Notable additions: `shapes/HtmlPageShapeUtil.tsx` and `shapes/pageBridge.ts` (page shape and iframe bridge), `actions/*` (new actions), `parts/PageMarksPartUtil.ts`, `components/TurnControls.tsx`, `ChatPanel.tsx`, `MicButton.tsx`, `AuthGate.tsx`, `fingerPan.ts` and `state.ts`.
- `server/`: the local server. `claude/ClaudeSession.ts` handles the Agent SDK session, `claude/parseActions.ts` the streaming JSON parser, and `prompt/` builds the system prompt.
- `shared/`: schemas and prompt-part definitions used by both sides.
- `.data/`: local state (passcode, session ids). Git-ignored.
- `NOTES.md`: decisions, what's unfinished, and what couldn't be verified without an iPad.

## License

This project is MIT licensed (see `LICENSE.md`): © 2026 Andrew Magliozzi, building on starter-kit code © tldraw Inc. (also MIT). The tldraw SDK itself is under the [tldraw SDK license](https://github.com/tldraw/tldraw/blob/main/LICENSE.md).
