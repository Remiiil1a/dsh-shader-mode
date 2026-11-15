/**
 * Shared helpers for `dsh-shader-mode`.
 *
 * The plugin deliberately imports nothing from `@deepseek-ai/*`: a
 * profile-installed bundle resolves its own dependencies, and the Harness
 * packages are optional peers that may not be reachable from the profile's
 * `node_modules`. Everything here is plain JavaScript plus `node:` builtins.
 *
 * A tool definition is therefore written directly in the registry's own shape
 * (`{ name, description, parameters, output, execute }`) instead of going
 * through `defineTool`, and each `execute` validates its own arguments.
 */

/** A tool call that failed for a reason the model should read and act on. */
export class ShaderModeError extends Error {
	/**
	 * @param {string} message - model-facing explanation.
	 * @param {string} code - stable machine code for the failure.
	 */
	constructor(message, code) {
		super(message)
		this.name = 'ShaderModeError'
		this.code = code
	}
}

/**
 * Build a registry-ready tool definition.
 *
 * @param {object} spec - the tool.
 * @param {string} spec.name - model-facing tool name.
 * @param {string} spec.description - model-facing description.
 * @param {Record<string, unknown>} spec.parameters - JSON Schema for the arguments.
 * @param {Record<string, unknown>} spec.outputSchema - JSON Schema for the canonical value.
 * @param {(args: any, exec: any) => Promise<any>} spec.execute - body returning the canonical value.
 * @param {(args: any, value: any) => Array<{ type: 'text', text: string }>} spec.render - model-facing projection.
 * @param {(args: any) => object | undefined} [spec.presentCall] - pending-state card.
 * @returns {object} a definition accepted by `ctx.tools.register`.
 */
export function defineShaderTool(spec) {
	return {
		name: spec.name,
		description: spec.description,
		parameters: spec.parameters,
		output: {
			schema: spec.outputSchema,
			render: spec.render,
		},
		...(spec.presentCall === undefined ? {} : { presentCall: spec.presentCall }),
		async execute(args, exec) {
			return spec.execute(args, exec)
		},
	}
}

/**
 * Read one required string argument.
 *
 * @param {Record<string, unknown>} args - parsed arguments.
 * @param {string} key - argument name.
 * @returns {string} the trimmed value.
 * @throws {ShaderModeError} when the argument is missing or blank.
 */
export function requireString(args, key) {
	const value = args?.[key]
	if (typeof value !== 'string' || value.trim() === '') {
		throw new ShaderModeError(`"${key}" is required and must be a non-empty string.`, 'INVALID_ARGUMENT')
	}
	return value.trim()
}

/**
 * Read an optional string argument.
 *
 * @param {Record<string, unknown>} args - parsed arguments.
 * @param {string} key - argument name.
 * @returns {string | undefined} the trimmed value, or undefined when absent.
 */
export function optionalString(args, key) {
	const value = args?.[key]
	if (value === undefined || value === null) return undefined
	if (typeof value !== 'string') {
		throw new ShaderModeError(`"${key}" must be a string when present.`, 'INVALID_ARGUMENT')
	}
	const trimmed = value.trim()
	return trimmed === '' ? undefined : trimmed
}

/**
 * Read an optional array-of-strings argument.
 *
 * @param {Record<string, unknown>} args - parsed arguments.
 * @param {string} key - argument name.
 * @returns {string[]} the trimmed, de-duplicated values; empty when absent.
 */
export function optionalStringArray(args, key) {
	const value = args?.[key]
	if (value === undefined || value === null) return []
	if (!Array.isArray(value)) {
		throw new ShaderModeError(`"${key}" must be an array of strings when present.`, 'INVALID_ARGUMENT')
	}
	const out = []
	for (const entry of value) {
		if (typeof entry !== 'string') {
			throw new ShaderModeError(`"${key}" must contain only strings.`, 'INVALID_ARGUMENT')
		}
		const trimmed = entry.trim()
		if (trimmed !== '' && !out.includes(trimmed)) out.push(trimmed)
	}
	return out
}

/**
 * Split a skill document into its YAML frontmatter and body.
 *
 * Only the flat `key: value` subset this package's own skills use is parsed;
 * that is deliberate, because a full YAML parser is a dependency this bundle
 * does not want. A document without frontmatter yields an empty header.
 *
 * @param {string} text - the raw `SKILL.md` contents.
 * @returns {{ header: Record<string, string>, body: string }} the parsed parts.
 */
export function splitFrontmatter(text) {
	const source = String(text).replace(/^\uFEFF/, '')
	if (!source.startsWith('---')) return { header: {}, body: source.trim() }
	const end = source.indexOf('\n---', 3)
	if (end === -1) return { header: {}, body: source.trim() }
	const rawHeader = source.slice(3, end)
	const body = source.slice(end + 4).replace(/^\r?\n/, '').trim()
	const header = {}
	for (const line of rawHeader.split(/\r?\n/)) {
		const match = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line)
		if (match === null) continue
		let value = match[2].trim()
		if (
			(value.startsWith('"') && value.endsWith('"') && value.length >= 2)
			|| (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
		) {
			value = value.slice(1, -1)
		}
		header[match[1]] = value
	}
	return { header, body }
}

/**
 * Render a one-line list for model-facing text.
 *
 * @param {readonly string[]} values - the items.
 * @param {string} [empty] - text used when the list is empty.
 * @returns {string} the joined list.
 */
export function listOr(values, empty = '(none)') {
	return values.length === 0 ? empty : values.join(', ')
}

/**
 * Truncate a label to a length the subagent catalog renders comfortably.
 *
 * @param {string} text - the candidate label.
 * @param {number} [max] - maximum length.
 * @returns {string} the label, shortened with an ellipsis when needed.
 */
export function clipLabel(text, max = 96) {
	const flat = String(text).replace(/\s+/g, ' ').trim()
	return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`
}
