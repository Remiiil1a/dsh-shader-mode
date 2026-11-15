---
name: shader-mode-dispatch
description: "How to write a dispatch a worker can actually execute: a self-contained brief, the exact skill assignment, the project workflow quoted from its own documents, and acceptance the lead can check. Use when composing a shader_dispatch call or when a worker report came back wrong because the brief was thin."
whenToUse: "Load before writing your first dispatch, and again whenever a worker misread the task."
---

# Writing a dispatch

A worker starts with no memory of this conversation. Everything it knows is what
you put in the dispatch. A dispatch that assumes context produces a report that
assumes context, and you will not be able to tell whether the work is right.

## The five fields

`shader_dispatch` takes `title`, `brief`, `skills`, `acceptance`, and optionally
`workflow`, `context`, `cwd`. Each has one job.

### `title` — one line, for the board

It appears on the board and in the worker's first line. Write what the task is,
not what phase it belongs to. `Fix the water boundary band` beats `Task 3`.

### `brief` — the task, written for a stranger

This is the field that decides whether the dispatch works. It must contain:

- **Where.** The files, directories, or modules involved, by path.
- **What.** The change, described concretely enough that two workers would do
  the same thing.
- **Why.** The constraint or symptom behind it. A worker that knows why can
  handle the case you did not anticipate; a worker that only knows what will
  follow the letter and break the spirit.
- **What not to touch.** The neighbouring thing that looks wrong but is
  deliberate. This is the highest-value sentence in most briefs.

Do not write "as discussed", "the usual way", or "same as last time". The worker
was not there.

### `skills` — the process, named exactly

Two or three skills. One that decides how the work is done, one that decides what
correct looks like. See `shader-mode-workflow` for the catalog and how to choose.

The tool refuses a dispatch with no skills. That is not a formality: a task whose
process you have not decided is a task you have not finished planning.

It also refuses a dispatch naming a skill written for a different role — a
whole-project flow, an orchestrator, or a user-facing role. Those skills assume
a user to freeze requirements with or a team to create, and a worker has
neither. The refusal names the skill and the role skill to use instead.

### `acceptance` — how you will judge it

Write the check, not the goal. The test: could someone else run this and get a
yes or no?

| Not acceptance | Acceptance |
|---|---|
| "the shader looks better" | "at t=0,1.5,3 the band count above luminance 0.4 is ≥3 and no pixel clips" |
| "the build passes" | "`_run_all.ps1 -Batch 739` exits 0 and prints `RISK = 0` seven times" |
| "the docs are updated" | "`HANDOVER.md` §2 names build 739 and the package entry count matches the zip" |
| "it works on mobile" | "at 390×844 the frame time stays under 16 ms over 300 frames" |

If you cannot write acceptance, you do not yet know what you are asking for.
Stop and decide before dispatching.

### `workflow` — quoted from the project

Paste the project's own numbered procedure, or the part of it this task sits in.
Quote it; do not paraphrase. A paraphrase is where a step goes missing.

For a project with no workflow yet, omit the field and say in `brief` that the
worker is establishing the process — but only after you have told the user you
are doing that.

### `context` — the facts a worker cannot look up

Prior decisions, what earlier tasks established, the user's stated preference,
the thing that was already tried and rejected. Keep it to facts. A worker that
receives your reasoning will argue with it instead of doing the task.

## Two dispatches, side by side

**Too thin:**

```
title: Fix the water
brief: The water boundary looks wrong, fix it.
skills: [shader-single]
acceptance: It looks right.
```

Three things are wrong here. The brief names no file and no constraint, so the
worker guesses. The acceptance is not checkable, so you cannot disagree with the
result. And `shader-single` is a whole-project flow that starts by freezing
requirements with a user — the worker has no user, so it will invent them. The
dispatch is refused before it starts.

**Workable:**

```
title: Remove the underwater chunk-boundary band
brief: |
  In Firmament/shaders/program/world/translucent.glsl, the vertical faces of
  water at a loaded-chunk edge sample a background that is not there and show
  sky. When the camera is underwater, the material is water, the face is
  vertical (abs(worldNormal.y) < 0.5), and the refraction sample lands on the
  far plane (refractedScreenPos.z >= 1.0), write underwaterFogColor and set
  srcAlpha to 0.0 instead.

  Do not drop the far-plane condition: glass windows in an underwater base are
  also vertical faces in water, and their refraction is wanted.

  Do not touch the Snell window work; it was removed deliberately.
skills: [shader-team-programmer, ds-verify-loop]
acceptance: |
  The file compiles under the project's frontend stage with 0 errors, and the
  project's full chain exits 0 with the same reading counts as the previous
  batch except for the files this task touched.
workflow: |
  The project's delivery order, from HANDOVER.md §7: run the full chain, run the
  frontend check, run --off for any default-on option touched, run the sweep for
  any default-off option touched, bump the build marker, fix the lang marker EOL,
  pack the batch, verify the zip entry count and byte equality, commit.
context: |
  Build 738 is current; the next batch is 739. The previous attempt at this
  (b712) added a Snell window and was reverted in b713 because the author read
  the band as a different geometry.
```

The second one can be executed by someone who was not here. That is the bar.

## When a report comes back wrong

Diagnose the dispatch before blaming the worker. In order:

1. **Was the acceptance checkable?** If not, the worker could not have known what
   you wanted. Fix the acceptance and re-dispatch.
2. **Was the brief self-contained?** If the worker had to guess a path or a
   constraint, the guess is your fault.
3. **Was the skill assignment right?** A worker told to use a lean process on a
   delivery task will produce a lean result.
4. **Only then** is it the worker's execution. Send it back with the specific
   gap, not with "try again".
