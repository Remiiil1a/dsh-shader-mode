# dsh-shader-mode

A lead/worker preset pair for shader work in DeepSeek Harness.

The lead talks to you, plans the work, and hands **every** task to a worker with
an explicit skill assignment. Workers never address you: their final message is
a report to the lead, and the lead is the one who decides whether it is good
enough.

## Why two presets

The point is not ceremony. A lead that also implements loses the ability to
judge — the same context that produced a change will defend it. Splitting the
roles is what makes the lead's acceptance check mean something.

The split is enforced by the composition, not by instructions:

| | `shader-lead` | `shader-worker` | any other mode |
|---|---|---|---|
| `shader_dispatch` / `shader_board` / `shader_route` | yes | **no** | **no** |
| lead standing instructions (system prompt) | yes | **no** | **no** |
| worker standing instructions | **no** | yes | **no** |
| bundled shader-mode skills | no | yes | **no** |
| talks to the user | yes | **no** | — |

A worker cannot dispatch because the tool is not in its catalog. A lead cannot
pick up the worker's instructions because they are mounted on the other preset.
And a session in any other mode sees none of it.

### The Host row registers nothing

This is the one structural rule that must not be broken. The bundle declares a
global Host row (`shader-mode`) and two preset rows. **A global row reaches every
session in the profile**; a preset row reaches only the sessions that chose it.

An earlier version mounted the lead's tools and prompt section on the global
row. The result: a standard-mode session working on a chrysanthemum
classification project had `shader_dispatch` in its tool list and "you are the
lead of a shader-mode session" in its system prompt, and dispatched a worker for
a task that had nothing to do with shaders.

So the global row validates its config and logs one line, and nothing else.
`scripts/verify-isolation.js` asserts it registers nothing, and asserts the two
preset halves share no registration.

### The rule is a prompt section, not a skill

A skill is loaded on demand: the model has to decide to call `skill` before its
rules exist. The first real shader-mode session proved the failure mode — the
preset was active, `shader_dispatch` was in the tool list, and the lead made 50
`edit` calls and 73 `pwsh` calls without ever calling `skill` once. The workflow
skill never entered its context.

So the four rules live in a **system-prompt section** (`shader-mode:lead`),
assembled into every model step. The skills still carry the detail; the section
carries the part that must not be missable.

### The guard

A rule in a prompt is advice, and advice loses to momentum. When the lead calls
a mutating tool (`edit`, `write`, `pwsh`, …) the call is allowed but a
corrective note is attached to the result, naming the tool and the next step.

It deliberately does not block. A lead sometimes has a real reason to touch a
file — reading back a worker's output, fixing its own dispatch text. Blocking
would turn a nudge into an obstacle and teach the lead to route around the
plugin. Turn it off with `remindOnDirectEdit: false`.

## Install

```powershell
# from a workspace checkout of this package
plugin_manager install_bundle --target <absolute path to this directory>
```

Then start a new session and select the **Shader mode (lead)** preset. The
worker preset is selected automatically by `shader_dispatch`; you never pick it
by hand.

## The loop

```
read the project's workflow
        ↓
plan the work as tasks
        ↓
dispatch one task  ──→  worker loads its skills, does the work, reports
        ↑                        ↓
        └──── judge the report ←─┘
                    ↓
        accept / rework / re-plan
                    ↓
        report to the user (only when the user needs to decide something)
```

## Tools

### `shader_dispatch`

Starts one worker on the `shader-worker` preset and returns its id immediately.

| Field | Required | What it is |
|---|---|---|
| `title` | yes | One line, shown on the board and in the worker's first line. |
| `brief` | yes | The task, written for someone who cannot see this conversation. |
| `skills` | yes | Skill names the worker must load first. **At least one.** |
| `acceptance` | yes | How the lead will judge the result, as checkable statements. |
| `workflow` | no | The project's own procedure, quoted. |
| `context` | no | Facts the worker cannot look up. |
| `cwd` | no | Working directory; defaults to the current one. |
| `allowLeadOnly` | no | Override the skill-role policy for this one dispatch. |

The skill assignment is written into the worker prompt as an instruction, not a
hint. A dispatch with no skills is refused: a task whose process you have not
decided is a task you have not finished planning.

### A skill must fit the role — and be loadable

More skills is not better. A skill is written for a *role*, and assigning one
written for a different role does not make the worker better — it makes the
worker try to be the lead, and the failure is quiet: the report comes back
looking complete.

`shader_dispatch` refuses three kinds by name:

| Kind | Why it breaks | Blocked by default |
|---|---|---|
| Whole-project flows | Start at requirement freezing, which needs a user. A worker has no user, so it invents the requirements and reports them as settled. | `shader-single`, `shader-single-strict` |
| Orchestrators | Create their own teammates and task board. A worker that loads one starts a second team underneath the lead. | `shader-team-lead` |
| User-facing roles | Anything whose job is to talk to the user, freeze requirements, or accept delivery. | (covered by the two above) |

The refusal names the skill, says why, and names the role skill to use instead.
`allowLeadOnly: true` overrides it for the real case where the lead has already
done the user-facing part and written it down — not as a way to silence the
check.

#### The skill manager blocks most skills

A second, unrelated trap: the skill manager writes
`disable-model-invocation: true` into **every skill it has not explicitly
enabled**. A skill with that flag is absent from the model-facing catalog and
the `skill` tool refuses it, so a worker told to load one fails at its first
step.

On this machine that blocked 24 of 44 installed skills — including every
`shader-team-*` role skill this package recommends. The lead could only assign
the two enabled ones.

`shader_dispatch` now checks before starting a worker and refuses with
`SKILL_NOT_INVOCABLE`, naming the skill and the fix. To unblock the set shader
mode needs:

```powershell
node scripts\enable-skills.js --dry-run   # report first
node scripts\enable-skills.js             # remove the flag from those skills
```

It edits only the named skills, only that one line, and writes a `.bak` first.
Restart the Host afterwards so the catalog is rebuilt.

The role skills are the ones written for exactly this split, and they stay
assignable:

| Skill | Assign it when |
|---|---|
| `shader-team-architect` | Turning a visual goal into math, a uniform contract, and a performance budget. |
| `shader-team-programmer` | Implementing against a frozen contract. |
| `shader-team-reviewer` | Independent verification; reports problems, does not fix them. |
| `shader-team-scribe` | Logging, git, archiving. |
| `shader-glsl` | Technique library — noise, SDF, warping, transitions. Safe for any worker. |

Process skills (`ds-plan-loop`, `ds-verify-loop`, `ds-tdd`, `ds-review-loop`,
`ds-unstick`) are role-neutral and fit any worker.

### `shader_board`

Reads the dispatch board: every task, its skills, its acceptance, and what came
back. Use it before a follow-up so you restate the task instead of re-deriving
it, and before reporting to the user so you do not claim work that is still open.

It reports **two** skill facts per task, and the difference matters:

- `skills` — what you assigned.
- `loadedSkills` — what the worker actually loaded, read from the child session's
  log. The Harness records each `skill` call as a user message whose source is
  `{ kind: 'skill-invocation', name }`, so this is a fact rather than a guess.

A worker that skipped an assigned skill shows up as `assigned but not loaded`.
`skillsReadable: false` means the session could not be read at all — which is
different from "loaded nothing", and is reported as such.

The board is a cache. If it is empty but workers exist, the Host restarted —
read the child sessions instead of assuming nothing was dispatched.

### Seeing the assignment in the conversation

The skill assignment otherwise lives only inside a tool call, which makes it a
black box. Two things surface it:

- The `shader_dispatch` card shows the assigned skills in both its pending and
  completed states, so the assignment is visible in the transcript without
  expanding the arguments.
- The lead's standing instructions require one line in the reply naming the task
  and its skills — `T1 派给 shader-team-programmer + ds-verify-loop`. That is a
  reporting duty, not a formality: it is how the user audits the lead's
  judgement.

### `shader_route`

Records what happened to a task: `reported`, `accepted`, `rework`, or `dropped`.
Rework rounds are counted, so a task that keeps coming back is visible as such.

## Bundled skills

Three skills ship in this package and are mounted on the worker preset:

| Skill | For |
|---|---|
| `shader-mode-workflow` | The lead's loop: read the project workflow, plan as tasks, dispatch, judge, report. |
| `shader-mode-dispatch` | How to write a brief a worker can execute, with worked good/bad examples. |
| `shader-mode-report` | How a worker reports: evidence, partial results, and what to do when blocked. |

They are mounted on the worker preset on purpose: they describe how a *worker*
behaves, and a lead that loaded them would be reading instructions addressed to
someone else.

The lead assigns skills from whatever the session's catalog contains. With
[deepseek-stack](https://github.com/aicodeking/deepseek-stack) installed that
includes the process skills (`ds-plan-loop`, `ds-verify-loop`, `ds-tdd`,
`ds-review-loop`, `ds-unstick`, `ds-lessons`, …); with the shader skills
installed it includes the domain ones (`shader-single`,
`shader-single-strict`, `shader-team-architect`, `shader-glsl`).

## Following the project's own workflow

Requirement: a new project gets its workflow designed by the lead; an existing
project gets its workflow **read**.

`shader-mode-workflow` tells the lead to find the handover document, pipeline
document, contributing guide, or build script before planning, and to quote the
project's numbered procedure into every dispatch's `workflow` field. A task that
skips a step in the project's own procedure is a task that will be sent back.

For a project with no workflow yet, the lead says so to the user and proposes one
before dispatching — it does not silently invent a process and present it later
as if it were the project's.

## Configuration

The `shader-mode` row in `cordis.patch.yml`:

| Field | Default | Meaning |
|---|---|---|
| `workerPreset` | `shader-worker` | Preset every dispatched worker runs on. |
| `maxDepth` | `1` | Delegation depth cap handed to each worker. **`1` permits direct children, which is what a dispatch is.** `0` does *not* mean "a leaf worker": a child's depth is the parent's depth plus one, so `0` rejects every dispatch with `SubagentDepthError`. |
| `leadOnlySkills` | built-in list | Skills that must not be assigned to a worker. Omit to keep the default (`shader-single`, `shader-single-strict`, `shader-team-lead`); supply an array to replace it. |
| `remindOnDirectEdit` | `true` | Attach a corrective note when the lead edits a file or runs a command itself. |

### The stop condition

The lead's section carries a second block of rules, and it exists because the
first version did not have one. A session with "judge the report, check the
evidence" and no bound on investigation produced the same paragraph five times
and had to be interrupted by hand three times.

The rules that prevent it:

- **Two checks per question, then decide.** A third confirmation is a loop.
- **Never re-derive a fact you already established.**
- **A wrong hypothesis is a result** — say it was wrong and move on.
- **Dispatch before you are certain** — a worker can investigate in parallel.
- **When the user says you are looping, you are.** Stop that line immediately.
- **Report a blocked state instead of grinding.** "I need this one fact from
  you" is a success; an hour of silent verification is not.

## Tests

```powershell
node tests\shader-mode.test.js
```

Fourteen offline checks over frontmatter parsing, the board, prompt composition,
and the tool bodies against a mock context.

Four scripts check the parts a unit test cannot reach:

| Script | What it proves |
|---|---|
| `scripts\verify-rows.js` | Each of the three rows exports `apply`, declares its `inject`, and resolves its config. |
| `scripts\verify-profile-resolution.js <profileDir>` | Every preset row resolves from the profile's module scope — the base the registry mounts with. |
| `scripts\verify-presets-mount.js` | The patch parses under the Loader's `!!js` dialect, all 32 plugin rows resolve, and the two presets carry disjoint shader-mode rows. |
| `scripts\verify-presets-live.js` | Both presets actually mount: the lead gets the three tools and no worker section, the worker gets the section and the skills and no tools, and a dispatch starts a child on the worker preset with the skills in its prompt. |

The last one is the one that matters. It caught two defects that the unit tests
could not: a missing `apply` export on the worker and skills rows, and a
`dsh.engines` block in the wrong place in the manifest.

## Layout

```
index.js          lead half: registers the three tools
tools.js          the tool bodies and worker-prompt composition
worker.js         worker standing instructions (preset-scoped section)
skills.js         bundled skill provider (preset-scoped)
lib/tool.js       tool definition + argument helpers, no Harness imports
lib/board.js      per-Session dispatch board
skills/*/SKILL.md the three bundled skills
cordis.patch.yml  the two presets and the Host row
```

Nothing here imports `@deepseek-ai/*`. A profile-installed bundle resolves its
own dependencies, and the Harness packages are optional peers that may not be
reachable from the profile's `node_modules`, so the tool definitions are written
directly in the registry's shape and each `execute` validates its own arguments.

## License

Unlicense — public domain, same as the repository it lives in.
