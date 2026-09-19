# Architecture

## Goal

This repository is intentionally small enough that its architecture can be understood in minutes.

The objective is not to imitate an enterprise backend in the browser. The objective is to make the important change boundaries explicit so game rules can evolve independently from DOM, Canvas, physical input devices, and browser frame scheduling.

## Dependency direction

```text
index.html
   |
script.js  ← composition root only
   |
   +--> adapters/input-controller.js
   +--> adapters/dom-game-view.js
   +--> adapters/canvas-renderer.js
   +--> adapters/browser-frame-scheduler.js
   |
   +--> application/game-controller.js
                 |
                 +--> application/game-loop.js
                 +--> domain/game.js
                           |
                           +--> domain/physics.js
                           +--> domain/opponent.js
```

Dependencies point inward.

- adapters may depend on the core
- application may depend on domain
- domain has no browser dependency
- application has no browser dependency
- the core never imports adapters

These rules are checked in CI by `scripts/check-project.mjs`.

## 1. Domain layer

`src/domain/` owns the rules that define the game:

- phases: `ready`, `running`, `paused`, `game-over`
- score transitions and win condition
- paddle bounds
- ball movement and wall reflection
- swept paddle collision
- bounce angle and speed progression
- opponent target and speed policy

The domain accepts plain data and returns new state. It does not draw, register listeners, query the DOM, schedule frames, or know which device produced an input command.

That makes the highest-value behavior directly testable with Node's built-in test runner.

## 2. Application layer

`GameController` owns orchestration:

- start
- pause/resume
- reset
- advance one simulation step
- translate current state into presentation data

It communicates through small ports supplied by the composition root:

- `input.snapshot()`
- `input.onCommand(...)`
- `view.onCommand(...)`
- `view.render(...)`
- `renderer.render(...)`
- frame scheduler injected into `FixedStepLoop`

The controller therefore contains application policy without knowing whether the concrete UI is DOM, Canvas, keyboard, touch, or something else.

## 3. Fixed-timestep loop

`src/application/game-loop.js` owns deterministic simulation timing.

The loop receives a scheduler dependency instead of calling `requestAnimationFrame` directly.

It:

1. measures elapsed real time
2. caps unusually large frame gaps
3. accumulates elapsed time
4. advances simulation in fixed 1/120-second increments
5. renders after the simulation catches up

This keeps game speed independent from 60 Hz vs 120 Hz displays and makes timing policy testable independently from the browser.

## 4. Adapters

Browser-specific concerns live in `src/adapters/`.

### InputController

Translates:

- pointer / mouse / touch movement
- Arrow Left / Arrow Right
- A / D
- Space

into device-neutral movement snapshots and commands.

### DomGameView

Owns buttons and status text. It translates UI clicks into application commands and presentation data back into DOM state.

### CanvasRenderer

Converts game state into pixels. It never decides scoring, collision, or winning rules.

### BrowserFrameScheduler

Wraps `requestAnimationFrame` / `cancelAnimationFrame`. This small adapter keeps browser scheduling out of the application core.

## State ownership

There is one authoritative game state owned by `GameController`.

Adapters do not mutate game state. Domain functions return new state objects, keeping transitions explicit and inspectable.

## Physics decisions

### Contact-position bounce

Outgoing direction depends on where the ball meets the paddle:

- center → mostly vertical return
- edge → greater horizontal component

Speed increases slightly after paddle contact and is capped so difficulty cannot grow without bound.

### Swept paddle collision

A simple overlap check can miss a paddle when a fast-moving ball travels from one side of the paddle plane to the other between simulation samples.

The current implementation:

1. computes the ball's leading edge at the previous and current positions
2. detects whether that segment crosses the paddle plane
3. calculates normalized crossing time `t`
4. interpolates the exact ball `x` at that crossing
5. checks horizontal overlap at the crossing point

This is intentionally smaller than a general-purpose continuous collision engine while solving the tunneling case relevant to this game.

## Opponent strategy

The opponent is deliberately understandable rather than unbeatable.

When the ball travels toward it, the strategy blends the ball's current position with a projected position. When the ball travels away, the opponent returns toward center.

Prediction and physical ability remain separate:

- prediction chooses a target
- speed cap limits how fast the paddle can reach it

## Executable architecture constraints

Documentation can become stale, so the project also encodes key architectural rules as checks.

`scripts/check-project.mjs` verifies that:

- expected modules exist
- `script.js` remains a small composition root
- domain/application files contain no browser-only APIs
- application files do not import adapters
- inline HTML event handlers are not introduced

If a future change violates these constraints, CI fails.

## Testing strategy

### Unit tests

The dependency-free unit suite targets deterministic rules:

- state-machine transitions
- scoring and win condition
- double-score prevention
- serve direction
- paddle clamping
- wall reflection
- center and edge bounce behavior
- speed cap
- swept collision
- opponent target and movement limits

### Browser smoke tests

Playwright checks the assembled system on desktop and mobile Chromium:

- application boot
- no page errors
- state transitions through UI and keyboard
- responsive Canvas visibility
- pointer interaction

The goal is not to duplicate every domain test in a browser. Browser tests cover integration seams; unit tests cover rule permutations.

## Deliberate omissions

The project does not add:

- React or another UI framework
- Redux/global state tooling
- a dependency-injection library
- a physics engine
- a repository/service abstraction with no external resource
- a bundler
- a backend

Those tools would increase surface area without solving current requirements.

## Extension points

The boundaries make future changes local:

- replace opponent strategy → `domain/opponent.js`
- tune difficulty → `config.js`
- replace Canvas → another renderer adapter
- replace DOM controls → another view adapter
- add gamepad support → another input adapter
- replace browser frame scheduling → another scheduler
- add second human player → input mapping + domain command
- add replay/debug snapshots → observe controller state without rewriting physics

The architecture exists to make change predictable, not to maximize the number of files.
