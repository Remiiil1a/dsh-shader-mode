/**
 * Reproduce `readPluginMeta` for this package and print what the Plugin
 * Manager would receive.
 *
 * The manager reads `locale/en.json` as the entry point, then enumerates every
 * `*.json` beside it into a per-language dictionary, and returns
 * `{ en, zh, ... }` objects for title and description. The Client picks one by
 * the active locale. This script shows the exact object, so a missing or
 * misnamed dictionary is visible without opening the UI.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const LOCALE_DIR = 'C:/Users/Administrator/Documents/Plugin_Create/dsh-shader-mode/locale'
const LANGUAGE_ID = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/

const dictionaries = new Map()
for (const entry of readdirSync(LOCALE_DIR, { withFileTypes: true })) {
	if (!entry.name.endsWith('.json')) continue
	const language = entry.name.slice(0, -5)
	if (!LANGUAGE_ID.test(language)) throw new Error(`${entry.name} must use a language id as its filename`)
	const parsed = JSON.parse(readFileSync(join(LOCALE_DIR, entry.name), 'utf8'))
	const meta = parsed.meta ?? {}
	dictionaries.set(language.toLowerCase(), {
		title: typeof meta.title === 'string' ? meta.title : undefined,
		description: typeof meta.description === 'string' ? meta.description : undefined,
	})
}

function localizedText(field, fallback) {
	const entries = [...dictionaries].flatMap(([language, fields]) => {
		const value = fields[field]
		return value === undefined ? [] : [[language, value]]
	})
	if (entries.length === 0) return fallback
	return { en: fallback ?? '', ...Object.fromEntries(entries) }
}

const manifest = JSON.parse(
	readFileSync('C:/Users/Administrator/Documents/Plugin_Create/dsh-shader-mode/package.json', 'utf8'),
)

console.log('dictionaries found:', [...dictionaries.keys()].join(', '))
console.log('\ntitle      :', JSON.stringify(localizedText('title', manifest.name), null, 2))
console.log('\ndescription:', JSON.stringify(localizedText('description', manifest.description), null, 2))
