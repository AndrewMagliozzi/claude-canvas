import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from '../env'

/**
 * The operating manual: the rules, preferences and plans the person and Claude
 * agree on together via the canvas worksheets. Stored as Markdown on the Mac
 * (.data/operating-manual.md) with every previous version kept, so it survives
 * across conversations and any Claude using the connector can follow it.
 */

const FILE = path.join(DATA_DIR, 'operating-manual.md')
const HISTORY = path.join(DATA_DIR, 'operating-manual-history')

export function readManual(): { markdown: string; version: number; updatedAt: string | null } {
	if (!fs.existsSync(FILE)) return { markdown: '', version: 0, updatedAt: null }
	const markdown = fs.readFileSync(FILE, 'utf8')
	const version = fs.existsSync(HISTORY) ? fs.readdirSync(HISTORY).filter((f) => f.endsWith('.md')).length : 1
	return { markdown, version, updatedAt: fs.statSync(FILE).mtime.toISOString() }
}

export function saveManual(markdown: string, summary: string): { version: number } {
	fs.mkdirSync(HISTORY, { recursive: true })
	const text = markdown.trim() + '\n'
	fs.writeFileSync(FILE, text)
	const version = fs.readdirSync(HISTORY).filter((f) => f.endsWith('.md')).length + 1
	const stamp = new Date().toISOString().replace(/[:.]/g, '-')
	fs.writeFileSync(path.join(HISTORY, `${String(version).padStart(3, '0')}-${stamp}.md`), `<!-- ${summary.replace(/-->/g, '')} -->\n${text}`)
	return { version }
}
