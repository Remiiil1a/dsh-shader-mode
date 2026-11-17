/**
 * Read what a worker actually loaded, not just what it was told to load.
 *
 * The lead assigns skills in a dispatch, but an assignment is a request. The
 * worker may load a different set — skip one, load an extra, or fail to find
 * one at all. Until now the only way to know was to open the child session,
 * which made the whole thing a black box.
 *
 * The Harness already records this. When a model calls the `skill` tool, the
 * tool injects the skill body as a user message whose source is
 * `{ kind: 'skill-invocation', name, form: 'instructions' }`. That message is
 * committed to the child's session log, so the loaded set is derivable from the
 * log rather than guessed from the assignment.
 *
 * This module reads those records through `ctx.sessionQuery`, which is the
 * live-preferred read face: a running worker is read from memory, a finished
 * one from persistence.
 */

/**
 * Collect the skills a session actually loaded.
 *
 * @param {object} ctx - the plugin context.
 * @param {string} sessionId - the worker's session id.
 * @param {AbortSignal} [signal] - cancellation.
 * @returns {Promise<{ loaded: string[], failed: string[], available: boolean }>} what was found.
 *   `available` is false when the session could not be read at all, which is
 *   different from "loaded nothing".
 */
export async function readLoadedSkills(ctx, sessionId, signal) {
	const query = ctx.get?.('sessionQuery') ?? ctx.sessionQuery
	if (query === undefined) return { loaded: [], failed: [], available: false }

	let events
	try {
		events = await readSessionEvents(query, sessionId, signal)
	} catch {
		return { loaded: [], failed: [], available: false }
	}
	if (events === undefined) return { loaded: [], failed: [], available: false }

	const loaded = []
	const failed = []
	for (const event of events) {
		if (event?.type !== 'user/message') continue
		const source = event.data?.message?.source
		if (source?.kind !== 'skill-invocation') continue
		const name = source.name
		if (typeof name !== 'string' || name === '') continue
		if (!loaded.includes(name)) loaded.push(name)
	}
	// A worker that was told to load a skill and could not is instructed to say
	// so in its report; there is no separate log record for the failure, so the
	// caller compares `loaded` against the assignment instead.
	return { loaded, failed, available: true }
}

/**
 * Read one session's events through the query service.
 *
 * The service's read face has changed shape across releases, so this tries the
 * documented entry points in order and returns undefined when none answers.
 * A caller that gets undefined reports "could not read", never "loaded nothing".
 *
 * @param {object} query - the session query service.
 * @param {string} sessionId - the session to read.
 * @param {AbortSignal} [signal] - cancellation.
 * @returns {Promise<object[] | undefined>} the events, or undefined.
 */
async function readSessionEvents(query, sessionId, signal) {
	// Preferred: a handle with an explicit event read.
	if (typeof query.open === 'function') {
		const handle = await query.open(sessionId, { signal })
		if (handle !== undefined && typeof handle.read === 'function') {
			const read = await handle.read({ signal })
			if (Array.isArray(read?.events)) return read.events
			if (Array.isArray(read)) return read
		}
		if (handle !== undefined && Array.isArray(handle.events)) return handle.events
	}
	// Fallback: a direct event read.
	if (typeof query.events === 'function') {
		const events = await query.events(sessionId, { signal })
		if (Array.isArray(events)) return events
	}
	// Fallback: a snapshot read.
	if (typeof query.snapshot === 'function') {
		const snapshot = await query.snapshot(sessionId, { signal })
		if (Array.isArray(snapshot?.events)) return snapshot.events
	}
	return undefined
}

/**
 * Compare an assignment against what a worker loaded.
 *
 * @param {readonly string[]} assigned - the skills the lead named.
 * @param {readonly string[]} loaded - the skills the worker actually loaded.
 * @returns {{ missing: string[], extra: string[] }} the differences.
 */
export function compareSkills(assigned, loaded) {
	return {
		missing: assigned.filter((name) => !loaded.includes(name)),
		extra: loaded.filter((name) => !assigned.includes(name)),
	}
}

/**
 * Render one line describing a worker's skill state.
 *
 * @param {readonly string[]} assigned - the skills the lead named.
 * @param {{ loaded: string[], available: boolean }} actual - what was read.
 * @returns {string} the line.
 */
export function describeSkills(assigned, actual) {
	if (!actual.available) {
		return `skills assigned: ${assigned.join(', ')} (could not read what the worker loaded)`
	}
	if (actual.loaded.length === 0) {
		return `skills assigned: ${assigned.join(', ')} — the worker has not loaded any yet`
	}
	const { missing, extra } = compareSkills(assigned, actual.loaded)
	const parts = [`skills loaded: ${actual.loaded.join(', ')}`]
	if (missing.length > 0) parts.push(`assigned but not loaded: ${missing.join(', ')}`)
	if (extra.length > 0) parts.push(`loaded but not assigned: ${extra.join(', ')}`)
	return parts.join(' | ')
}
