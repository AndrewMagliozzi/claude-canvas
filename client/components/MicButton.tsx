import { useEffect, useRef, useState } from 'react'
import { $draft, setDraft } from '../state'

/**
 * Dictation into the chat box via the Web Speech API.
 *
 * Safari only allows the microphone on secure origins (HTTPS or localhost),
 * so over plain http on the LAN the button explains how to enable it instead.
 * Speech never auto-sends: it only fills the draft, and you press Send.
 */

type Recognition = {
	continuous: boolean
	interimResults: boolean
	lang: string
	start(): void
	stop(): void
	abort(): void
	onresult: ((e: any) => void) | null
	onerror: ((e: any) => void) | null
	onend: (() => void) | null
}

function getRecognitionCtor(): (new () => Recognition) | null {
	const w = window as any
	return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function getVoiceSupport(): { ok: true } | { ok: false; reason: string } {
	if (!getRecognitionCtor()) return { ok: false, reason: "This browser doesn't support speech recognition." }
	if (!window.isSecureContext) {
		return { ok: false, reason: 'Voice input needs HTTPS. On the Mac run `npm run dev:https` (see README → Voice).' }
	}
	return { ok: true }
}

export function MicButton() {
	const [listening, setListening] = useState(false)
	const [notice, setNotice] = useState<string | null>(null)
	const recRef = useRef<Recognition | null>(null)
	const baseRef = useRef('')
	const support = getVoiceSupport()

	useEffect(() => () => recRef.current?.abort(), [])

	useEffect(() => {
		if (!notice) return
		const t = setTimeout(() => setNotice(null), 5000)
		return () => clearTimeout(t)
	}, [notice])

	const start = () => {
		if (!support.ok) {
			setNotice(support.reason)
			return
		}
		const Ctor = getRecognitionCtor()!
		const rec = new Ctor()
		rec.continuous = true
		rec.interimResults = true
		rec.lang = navigator.language || 'en-US'
		const base = $draft.get()
		baseRef.current = base && !base.endsWith(' ') ? base + ' ' : base
		rec.onresult = (e: any) => {
			let finalText = ''
			let interim = ''
			for (let i = 0; i < e.results.length; i++) {
				const r = e.results[i]
				if (r.isFinal) finalText += r[0].transcript
				else interim += r[0].transcript
			}
			setDraft(baseRef.current + finalText + interim)
		}
		rec.onerror = (e: any) => {
			if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
				setNotice('Microphone permission was denied. Allow it in Safari settings for this site.')
			} else if (e.error !== 'aborted' && e.error !== 'no-speech') {
				setNotice(`Voice error: ${e.error}`)
			}
		}
		rec.onend = () => {
			setListening(false)
			recRef.current = null
		}
		try {
			rec.start()
			recRef.current = rec
			setListening(true)
		} catch (err: any) {
			setNotice(`Couldn't start voice input: ${err?.message ?? err}`)
		}
	}

	const stop = () => recRef.current?.stop()

	return (
		<span className="mic-wrap">
			<button
				type="button"
				className={`mic-button ${listening ? 'listening' : ''} ${support.ok ? '' : 'unavailable'}`}
				onClick={listening ? stop : start}
				title={support.ok ? (listening ? 'Stop dictation' : 'Dictate') : support.reason}
				aria-label={listening ? 'Stop dictation' : 'Dictate'}
			>
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
					<rect x="9" y="3" width="6" height="11" rx="3" />
					<path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
				</svg>
			</button>
			{notice && <span className="mic-notice">{notice}</span>}
		</span>
	)
}
