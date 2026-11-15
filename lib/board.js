/**
 * The dispatch board: one in-memory record per Session of the tasks its lead
 * handed to workers.
 *
 * The board is a derived cache, never a source of truth. The durable record of
 * a dispatch is the child Session itself plus the parent's `subagentCatalog`
 * projection, both owned by the Harness. This file only keeps the extra facts
 * the catalog does not carry — which skills were assigned, what the acceptance
 * check was, and what the worker reported back — so the lead can restate a
 * task without re-reading a child transcript.
 *
 * Losing the board (a Host restart) costs a re-read, not correctness: every
 * entry is re-derivable from the child Session, and `shader_board` says so
 * instead of pretending an empty board means no work was dispatched.
 */

/** Task states a dispatch can be in. */
export const TASK_STATES = ['dispatched', 'reported', 'accepted', 'rework', 'dropped']

/**
 * One board: the tasks of a single lead Session.
 */
export class Board {
	constructor() {
		/** @type {Map<string, object>} task id → task record. */
		this.tasks = new Map()
		/** @type {Map<string, string>} child session id → task id. */
		this.byChild = new Map()
		/** Monotonic counter behind the readable task ids. */
		this.counter = 0
	}

	/**
	 * Record a newly dispatched task.
	 *
	 * @param {object} input - the dispatch.
	 * @param {string} input.childId - the worker's session id.
	 * @param {string} input.title - short task title.
	 * @param {string} input.brief - the full task text handed to the worker.
	 * @param {string[]} input.skills - skills the lead told the worker to load.
	 * @param {string} input.acceptance - how the lead will judge the result.
	 * @param {string | undefined} input.workflow - the project workflow being followed.
	 * @returns {object} the stored task.
	 */
	add(input) {
		this.counter += 1
		const id = `T${this.counter}`
		const task = {
			id,
			childId: input.childId,
			title: input.title,
			brief: input.brief,
			skills: [...input.skills],
			acceptance: input.acceptance,
			workflow: input.workflow ?? null,
			state: 'dispatched',
			report: null,
			reworkRounds: 0,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		}
		this.tasks.set(id, task)
		this.byChild.set(input.childId, id)
		return task
	}

	/**
	 * Look a task up by its own id or by the worker's session id.
	 *
	 * @param {string} key - task id or child session id.
	 * @returns {object | undefined} the task.
	 */
	find(key) {
		const direct = this.tasks.get(key)
		if (direct !== undefined) return direct
		const id = this.byChild.get(key)
		return id === undefined ? undefined : this.tasks.get(id)
	}

	/**
	 * Record what a worker reported back.
	 *
	 * @param {object} task - the task being updated.
	 * @param {string} report - the worker's report, as the lead received it.
	 * @returns {object} the same task, mutated.
	 */
	recordReport(task, report) {
		task.report = report
		task.state = 'reported'
		task.updatedAt = Date.now()
		return task
	}

	/**
	 * Move a task to a new state.
	 *
	 * @param {object} task - the task being updated.
	 * @param {string} state - one of {@link TASK_STATES}.
	 * @param {string | undefined} [note] - why the state changed.
	 * @returns {object} the same task, mutated.
	 */
	setState(task, state, note) {
		if (!TASK_STATES.includes(state)) {
			throw new Error(`unknown task state "${state}"`)
		}
		task.state = state
		if (state === 'rework') task.reworkRounds += 1
		if (note !== undefined) task.note = note
		task.updatedAt = Date.now()
		return task
	}

	/**
	 * Every task, in dispatch order.
	 *
	 * @returns {object[]} the tasks.
	 */
	list() {
		return [...this.tasks.values()]
	}

	/**
	 * Tasks that still need the lead's attention.
	 *
	 * @returns {object[]} tasks in `dispatched` or `reported` state.
	 */
	open() {
		return this.list().filter((task) => task.state === 'dispatched' || task.state === 'reported')
	}
}

/**
 * The board registry: one {@link Board} per lead Session, dropped when the
 * plugin unloads.
 */
export class BoardRegistry {
	constructor() {
		/** @type {Map<string, Board>} session id → board. */
		this.boards = new Map()
	}

	/**
	 * The board for one Session, created on first use.
	 *
	 * @param {string} sessionId - the lead's session id.
	 * @returns {Board} the board.
	 */
	for(sessionId) {
		let board = this.boards.get(sessionId)
		if (board === undefined) {
			board = new Board()
			this.boards.set(sessionId, board)
		}
		return board
	}

	/**
	 * The board for one Session when it already exists.
	 *
	 * @param {string} sessionId - the lead's session id.
	 * @returns {Board | undefined} the board.
	 */
	peek(sessionId) {
		return this.boards.get(sessionId)
	}

	/** Drop every board. */
	clear() {
		this.boards.clear()
	}
}
