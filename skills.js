/**
 * The bundled skill provider.
 *
 * Shader mode's whole premise is that the lead names the skills a worker must
 * load. That only works if the names are real and the worker can actually load
 * them, so this provider ships the shader-mode skills inside the package and
 * registers them on the preset's own skill layer.
 *
 * Registering on the preset layer (rather than globally) is deliberate: the
 * skills describe how a *worker* behaves, and a lead that loaded them would be
 * reading instructions addressed to someone else.
 *
 * The provider reads from disk on every `list`, so editing a `SKILL.md` in the
 * installed package takes effect on the next catalog without a restart.
 */

import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { splitFrontmatter } from './lib/tool.js'

/** The provider name reported on every skill it serves. */
const PROVIDER_NAME = 'shader-mode'

/** Services this row needs before it can activate. */
export const inject = ['skills']

/** Rank inside the preset layer; below project skills, above nothing else. */
const RANK = 300

/**
 * Resolve the directory holding this package's `skills/`.
 *
 * @returns {string} the absolute directory.
 */
function skillsRoot() {
	return fileURLToPath(new URL('./skills/', import.meta.url))
}

/**
 * Read one skill directory into a candidate.
 *
 * @param {string} root - the `skills/` directory.
 * @param {string} entry - the directory name.
 * @returns {Promise<object | undefined>} the candidate, or undefined when the
 *   directory holds no readable `SKILL.md` with a name and description.
 */
async function readCandidate(root, entry) {
	const path = join(root, entry, 'SKILL.md')
	let text
	try {
		text = await readFile(path, 'utf8')
	} catch {
		return undefined
	}
	const { header } = splitFrontmatter(text)
	const name = header.name ?? entry
	const description = header.description
	if (typeof description !== 'string' || description === '') return undefined
	return {
		name,
		description,
		...(header.whenToUse === undefined ? {} : { whenToUse: header.whenToUse }),
		source: 'custom',
		rank: RANK,
		locator: { path },
		metadata: { package: 'dsh-shader-mode' },
	}
}

/**
 * Build the provider object `ctx.skills.registerProvider` expects.
 *
 * @returns {object} the provider.
 */
export function createSkillProvider() {
	return {
		name: PROVIDER_NAME,
		async list() {
			const root = skillsRoot()
			let entries
			try {
				entries = await readdir(root, { withFileTypes: true })
			} catch {
				// A package installed without its skills is a packaging fault, not a
				// reason to fail the whole preset: report an empty, complete catalog.
				return { candidates: [], complete: true }
			}
			const candidates = []
			for (const entry of entries) {
				if (!entry.isDirectory()) continue
				const candidate = await readCandidate(root, entry.name)
				if (candidate !== undefined) candidates.push(candidate)
			}
			candidates.sort((left, right) => left.name.localeCompare(right.name))
			return { candidates, complete: true }
		},
		async get(candidate) {
			const path = candidate?.locator?.path
			if (typeof path !== 'string') return undefined
			let text
			try {
				text = await readFile(path, 'utf8')
			} catch {
				return undefined
			}
			const { header, body } = splitFrontmatter(text)
			return {
				name: header.name ?? candidate.name,
				description: header.description ?? candidate.description,
				...(header.whenToUse === undefined ? {} : { whenToUse: header.whenToUse }),
				source: candidate.source,
				provider: PROVIDER_NAME,
				rank: candidate.rank,
				locator: candidate.locator,
				resourceBase: { kind: 'directory', path: join(path, '..') },
				content: body,
			}
		},
	}
}

/**
 * Mount the provider on the calling (preset-scoped) context.
 *
 * @param {object} ctx - the preset-scoped plugin context.
 * @returns {void}
 */
export function mountSkillProvider(ctx) {
	ctx.skills.registerProvider(() => createSkillProvider())
}

/**
 * Activate the skills row.
 *
 * @param {object} ctx - the preset-scoped plugin context.
 * @returns {void}
 */
export function apply(ctx) {
	mountSkillProvider(ctx)
}
