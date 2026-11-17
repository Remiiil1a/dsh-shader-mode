/**
 * Make the shader-mode skills loadable by the model.
 *
 * The skill manager writes `disable-model-invocation: true` into every skill it
 * has not explicitly enabled. A skill with that flag is absent from the
 * model-facing catalog and the `skill` tool refuses it, so a worker told to
 * load one fails at its first step — which is what happened: the lead could
 * only assign the two enabled skills, and the role skills this package
 * recommends were all blocked.
 *
 * This script removes that one line from the frontmatter of the skills shader
 * mode needs. It is deliberately narrow: it edits only the named skills, only
 * that one line, and it writes a `.bak` first so the change is reversible.
 *
 * Usage:
 *   node scripts/enable-skills.js            # the shader-mode skill set
 *   node scripts/enable-skills.js --dry-run  # report, change nothing
 *   node scripts/enable-skills.js --all      # every installed skill
 *   node scripts/enable-skills.js a b c      # exactly these names
 *
 * @module
 */

import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Skills shader mode assigns to workers, plus the process skills it pairs them with. */
const SHADER_MODE_SKILLS = [
	// Role skills: what a worker is told to load.
	'shader-team-architect',
	'shader-team-programmer',
	'shader-team-reviewer',
	'shader-team-scribe',
	// Technique library: safe for any worker.
	'shader-glsl',
	// Process skills the workflow recommends.
	'ds-plan-loop',
	'ds-verify-loop',
	'ds-tdd',
	'ds-review-loop',
	'ds-unstick',
	'ds-lessons',
]

/** The line this script removes, in the spellings the frontmatter accepts. */
const FLAG = /^disable-model-invocation\s*:\s*true\s*$/i

/**
 * Split a SKILL.md into frontmatter lines and body.
 *
 * @param {string} text - the file contents.
 * @returns {{ header: string[], body: string, hasFrontmatter: boolean }} the parts.
 */
function split(text) {
	const source = text.replace(/^\uFEFF/, '')
	if (!source.startsWith('---')) return { header: [], body: source, hasFrontmatter: false }
	const end = source.indexOf('\n---', 3)
	if (end === -1) return { header: [], body: source, hasFrontmatter: false }
	return {
		header: source.slice(3, end).split(/\r?\n/),
		body: source.slice(end),
		hasFrontmatter: true,
	}
}

/**
 * Remove the flag from one skill file.
 *
 * @param {string} path - the SKILL.md path.
 * @param {boolean} dryRun - report without writing.
 * @returns {'enabled' | 'already' | 'no-frontmatter'} what happened.
 */
function enable(path, dryRun) {
	const text = readFileSync(path, 'utf8')
	const { header, body, hasFrontmatter } = split(text)
	if (!hasFrontmatter) return 'no-frontmatter'
	const kept = header.filter((line) => !FLAG.test(line.trim()))
	if (kept.length === header.length) return 'already'
	if (!dryRun) {
		copyFileSync(path, `${path}.bak`)
		writeFileSync(path, `---${kept.join('\n')}${body}`, 'utf8')
	}
	return 'enabled'
}

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const all = args.includes('--all')
const explicit = args.filter((arg) => !arg.startsWith('--'))
const root = process.env.DSH_SKILLS_DIR ?? join(process.env.USERPROFILE ?? process.env.HOME ?? '.', '.dsh', 'skills')

if (!existsSync(root)) {
	console.error(`skills directory not found: ${root}`)
	console.error('set DSH_SKILLS_DIR to the directory holding the skill folders')
	process.exit(1)
}

const targets = all
	? readdirSync(root, { withFileTypes: true })
			.filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, 'SKILL.md')))
			.map((entry) => entry.name)
	: explicit.length > 0
		? explicit
		: SHADER_MODE_SKILLS

console.log(`skills directory: ${root}`)
console.log(`mode: ${dryRun ? 'dry run' : 'write'}   targets: ${targets.length}\n`)

const counts = { enabled: 0, already: 0, missing: 0, 'no-frontmatter': 0 }
for (const name of targets) {
	const path = join(root, name, 'SKILL.md')
	if (!existsSync(path)) {
		console.log(`--  ${name}: not installed`)
		counts.missing += 1
		continue
	}
	const result = enable(path, dryRun)
	counts[result] += 1
	const label = {
		enabled: dryRun ? 'would enable' : 'enabled',
		already: 'already enabled',
		'no-frontmatter': 'no frontmatter, skipped',
	}[result]
	console.log(`${result === 'enabled' ? 'ok' : '--'}  ${name}: ${label}`)
}

console.log(
	`\n${counts.enabled} ${dryRun ? 'to enable' : 'enabled'}, ${counts.already} already enabled, ${counts.missing} not installed, ${counts['no-frontmatter']} skipped`,
)
if (counts.enabled > 0 && !dryRun) {
	console.log('\nRestart the Host so the skill catalog is rebuilt, then dispatch again.')
}
