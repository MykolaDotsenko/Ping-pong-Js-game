# Architecture

## Goal

This repository is intentionally small enough that its architecture can be understood in minutes.

The objective is not to imitate an enterprise backend in the browser. The objective is to make the important change boundaries explicit so game rules can evolve independently from DOM, Canvas, physical input devices, and browser frame scheduling.

## Dependency direction

```text
index.html
   |
script.js  ← composition root; the only module that touches browser globals
   |
   +--> adapters/input-controller.js
   +--> adapters/dom-game-view.js
   +--> adapters/canvas-renderer.js
   +--> adapters/browser-frame-scheduler.js
   |
   +--> application/game-controller.js
                 |
                 +--> application/ports.js
                 +--> application/game-loop.js
                 +--> application/interpolation.js
                 +--> domain/game.js
                           |
                           +--> domain/physics.js
                           +--> domain/opponent.js
```

Dependencies point inward.

- adapters may depend on the core
- application may depend on domain
- domain depends on nothing outside `src/domain/`
- domain and application see no browser or Node globals, no clock, and no `Math.random`
- the core never imports adapters
- adapters receive `window` and `document` from the composition root instead of reading globals

These rules are enforced by ESLint per directory (`eslint.config.js`). `tests/architecture-rules.test.js` lints deliberate violations to prove the rules keep rejecting them.

## 1. Domain layer

`src/domain/` owns the rules that define the game:

- phases: `ready`, `running`, `paused`, `game-over`
- score transitions, win condition, and winner
- paddle bounds
- ball movement and wall reflection
- swept paddle collision
- bounce angle and speed progression
- opponent target and speed policy

The domain accepts plain data and returns new state. It does not draw, register listeners, query the DOM, schedule frames, read the clock, or know which device produced an input command. The shapes it works with (`GameState`, `GameConfig`, `InputSnapshot`) are declared once in `src/domain/types.js`.

That makes the highest-value behavior directly testable with Node's built-in test runner, and fully deterministic: the same inputs always produce the same match.

## 2. Application layer

`GameController` owns orchestration:

- start, pause/resume, reset
- idempotent pause when the page loses focus
- advance one simulation step
- run the frame loop only while a match is running
- translate current state into presentation data

It talks to adapters through the ports declared in `src/application/ports.js`:

- `InputPort` — `snapshot()`, `onCommand(...)`
- `ViewPort` — `render(presentation)`, `onCommand(...)`
- `RendererPort` — `render(state)`
- `FrameScheduler` — `request(...)`, `cancel(...)`, injected into `FixedStepLoop`

The input, view, and renderer ports also expose `connect()` / `disconnect()`. The ports are JSDoc type definitions, and `npm run typecheck` uses the TypeScript compiler to verify that every adapter satisfies them and that the controller only uses what they promise. Commands are a closed set (`GAME_COMMAND`), so an unknown command is a type error instead of a silent no-op.

The controller therefore contains application policy without knowing whether the concrete UI is DOM, Canvas, keyboard, touch, or something else.

## 3. Fixed-timestep loop

`src/application/game-loop.js` owns deterministic simulation timing.

The loop receives a scheduler dependency instead of calling `requestAnimationFrame` directly.

It:

1. measures elapsed real time
2. caps unusually large frame gaps
3. accumulates elapsed time
4. advances simulation in fixed 1/120-second increments
5. renders after the simulation catches up, passing how far time has moved into the next step

The controller uses that fraction to blend the last two simulation states (`interpolateState`), so motion stays smooth on 60, 120 and 144 Hz displays alike. A serve teleports the ball, so states across a serve are never blended.

The loop is stopped whenever the match is not running, including from inside an update when the winning point is scored. Ready, paused, and game-over screens are drawn once and then cost nothing.

## 4. Adapters

Browser-specific concerns live in `src/adapters/`.

### InputController

Translates pointer, mouse, touch, and keyboard input into device-neutral movement snapshots and commands. Its policy:

- keys are matched by physical code (`KeyA`, `KeyD`, arrows, `Space`), so layouts such as Ukrainian or AZERTY work
- combinations with `Ctrl`, `Meta` or `Alt` are left to the browser
- the most recently used device steers; a key press takes over from a resting mouse, and a horizontal pointer move or a tap takes over from the keyboard
- losing window focus or hiding the page releases held keys and sends an idempotent pause, because key-up events are lost while the page is unfocused

### DomGameView

Owns buttons and status text. It translates clicks into application commands and presentation data back into DOM state. After any click it hands focus back to the board, so `Space` controls the game instead of re-activating the focused button. It only writes to the DOM when the presentation changes, which keeps the `aria-live` status region from being rewritten every frame.

### CanvasRenderer

Converts game state into pixels. It never decides scoring, collision, or winning rules. It sizes the canvas backing store to the displayed size in device pixels, and re-sizes on layout and pixel-ratio changes such as browser zoom, so the board stays sharp on high-density screens. Drawing code keeps working in board coordinates through the context transform.

### BrowserFrameScheduler

Wraps `requestAnimationFrame` / `cancelAnimationFrame` of the injected window. This small adapter keeps browser scheduling out of the application core.

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

Documentation can become stale, so the project encodes its rules as checks that fail CI:

- `eslint.config.js` — layer boundaries, no host globals or clock or randomness in the core, browser globals only in the composition root
- `tests/architecture-rules.test.js` — proves those lint rules still catch violations
- `tsconfig.json` + `npm run typecheck` — adapters satisfy the port contracts
- `scripts/check-project.mjs` — expected modules exist, `script.js` stays a small composition root, no inline HTML event handlers

## Testing strategy

### Unit tests

The dependency-free unit suite targets deterministic rules and the logic of the adapters:

- domain: state machine, scoring, serves, paddle control, collisions toward both paddles, the speed cap, and a full rally
- application: loop lifecycle, interpolation, commands, and status text
- adapters: input policy and view behavior, driven through fake event targets thanks to injected globals
- architecture: the lint rules themselves

A coverage gate (95% lines, 90% branches and functions over `src/`) keeps it that way.

### Browser tests

Playwright checks the assembled system on desktop and mobile Chromium. Instead of reaching into application state, the tests read the player paddle's position from the canvas pixels. They cover:

- application boot without page errors
- state transitions through buttons and the keyboard, including `Space` after a mouse click
- mouse steering and the keyboard taking over from a resting mouse
- layout-independent keys and touch taps
- auto-pause on focus loss
- an idle render loop and a quiet live region outside of a match
- a canvas backing store that matches device pixels

The goal is not to duplicate every domain test in a browser. Browser tests cover integration seams; unit tests cover rule permutations.

## Deliberate omissions

The project does not add:

- React or another UI framework
- Redux/global state tooling
- a dependency-injection library
- a physics engine
- a repository/service abstraction with no external resource
- a bundler or a compile step
- a backend

Those tools would increase surface area without solving current requirements.

## Extension points

The boundaries make future changes local:

- replace opponent strategy → `domain/opponent.js`
- tune difficulty → `config.js`
- randomize serves → inject a seeded random source, keeping the core deterministic
- replace Canvas → another `RendererPort` adapter
- replace DOM controls → another `ViewPort` adapter
- add gamepad support → another `InputPort` adapter
- replace browser frame scheduling → another `FrameScheduler`
- add second human player → input mapping + domain command
- add replay/debug snapshots → observe controller state without rewriting physics

The architecture exists to make change predictable, not to maximize the number of files.
