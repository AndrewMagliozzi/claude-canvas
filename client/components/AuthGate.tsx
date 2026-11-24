import { FormEvent, useState } from 'react'
import { submitPasscode } from '../api'

/** Asks for the passcode printed in the Mac's terminal. */
export function AuthGate() {
	const [code, setCode] = useState('')
	const [error, setError] = useState<string | null>(null)
	const [busy, setBusy] = useState(false)

	const onSubmit = async (e: FormEvent) => {
		e.preventDefault()
		setBusy(true)
		setError(null)
		const res = await submitPasscode(code)
		setBusy(false)
		if (!res.ok) setError(res.error ?? 'Wrong passcode')
	}

	return (
		<div className="auth-gate">
			<form className="auth-card" onSubmit={onSubmit}>
				<div className="auth-title">Claude Canvas</div>
				<p className="auth-hint">Enter the passcode shown in the terminal on your Mac.</p>
				<input
					className="auth-input"
					inputMode="numeric"
					autoComplete="one-time-code"
					autoFocus
					maxLength={12}
					value={code}
					onChange={(e) => setCode(e.target.value.replace(/\s/g, ''))}
					placeholder="••••••"
					aria-label="Passcode"
				/>
				{error && <div className="auth-error">{error}</div>}
				<button className="auth-button" disabled={busy || code.length < 4}>
					{busy ? 'Checking…' : 'Unlock'}
				</button>
			</form>
		</div>
	)
}
