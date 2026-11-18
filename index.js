/**
 * `dsh-shader-mode` — the Host row.
 *
 * This row is **global**: it is mounted once for the whole profile, outside any
 * preset, so anything it registers reaches every session in every mode. That
 * makes it the wrong place for the lead's tools, prompt section, or guard —
 * registering them here leaked `shader_dispatch` into a standard-mode session
 * and injected "you are the lead of a shader-mode session" into its system
 * prompt, which is exactly what happened in the chrysanthemum session.
 *
 * So this file registers nothing. It resolves and validates the configuration
 * the preset rows read, and it exists so the bundle has a Host entry that can
 * report a bad configuration at activation instead of at first dispatch.
 *
 * The lead's behaviour lives in `./lead.js`, mounted only on the `shader-lead`
 * preset. The worker's lives in `./worker.js` and `./skills.js`, mounted only
 * on `shader-worker`.
 */

/** Services this row needs. It registers nothing, so it needs none. */
export const inject = []

/**
 * Resolve the row's configuration.
 *
 * @param {unknown} config - the Loader row config.
 * @returns {{ workerPreset: string, maxDepth: number, leadOnlySkills: unknown, remindOnDirectEdit: boolean }} the resolved values.
 */
export function resolveConfig(config) {
	const raw = config !== null && typeof config === 'object' ? config : {}
	return {
		workerPreset:
			typeof raw.workerPreset === 'string' && raw.workerPreset !== '' ? raw.workerPreset : 'shader-worker',
		maxDepth: Number.isSafeInteger(raw.maxDepth) && raw.maxDepth >= 1 ? raw.maxDepth : 1,
		// Undefined keeps the built-in policy; an array replaces it, so a profile
		// can add a skill this package has not heard of.
		leadOnlySkills: Array.isArray(raw.leadOnlySkills) ? raw.leadOnlySkills : undefined,
		// The guard is on by default: the first real session showed that a rule
		// in a prompt loses to momentum, so the reminder is a mechanism.
		remindOnDirectEdit: raw.remindOnDirectEdit !== false,
	}
}

/**
 * Activate the Host row.
 *
 * Deliberately does nothing but validate. A Host row that registers a tool
 * makes that tool visible in every session of the profile, which is the bug
 * this file was rewritten to fix.
 *
 * @param {object} ctx - the plugin context.
 * @param {unknown} config - the Loader row config.
 * @returns {void}
 */
export function apply(ctx, config) {
	const resolved = resolveConfig(config)
	if (resolved.maxDepth < 0) {
		throw new Error('dsh-shader-mode: maxDepth must be zero or greater')
	}
	// A logger line, not a registration: this is the only side effect a global
	// row is allowed to have.
	ctx.logger?.('dsh-shader-mode')?.info?.(
		`shader mode ready: workers run on preset "${resolved.workerPreset}", maxDepth ${resolved.maxDepth}`,
	)
}
