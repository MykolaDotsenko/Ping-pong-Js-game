# Architecture

## Goal

This repository is intentionally small enough that its architecture can be understood in minutes.

The objective is not to imitate an enterprise backend in the browser. The objective is to make the important change boundaries explicit so game rules can evolve independently from DOM, Canvas, audio, physical input devices, and browser frame scheduling, and to show that those boundaries leave room for a polished, juicy game rather than getting in its way.

## Dependency direction

```text
index.html
   |
script.js  ← composition root; the only module that touches browser globals
   |
   +--> adapters/input-controller.js
   +--> adapters/dom-game-view.js
   +--> adapters/canvas-renderer.js ──> adapters/effects.js
   +--> adapters/sound-board.js
   +--> adapters/haptics.js
   +--> adapters/local-preferences.js
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
- adapters receive `window`, `document` and `navigator` from the composition root instead of reading globals

These rules are enforced by ESLint per directory (`eslint.config.js`). `tests/architecture-rules.test.js` lints deliberate violations to prove the rules keep rejecting them.

## 1. Domain layer

`src/domain/` owns the rules that define the game:

- phases: `ready`, `running`, `paused`, `game-over`
- score transitions, win condition, and winner
- the serve countdown: the ball waits at the center before each serve while the paddles can already move
- rallies: hits since the serve, and the longest rally of the match
- paddle bounds and smoothed paddle velocity
- ball movement, wall reflection, swept paddle collision, bounce angles and speed progression
- spin, and the curve it puts on the ball
- the computer opponent

The domain accepts plain data and returns new state. It does not draw, play sounds, register listeners, query the DOM, schedule frames, read the clock, or know which device produced an input command. The shapes it works with (`GameState`, `GameConfig`, `InputSnapshot`, `GameEvent`) are declared once in `src/domain/types.js`.

That makes the highest-value behavior directly testable with Node's built-in test runner, and fully deterministic: the same inputs always produce the same match.

### Game events

Every transition lists what happened in `state.events`: `match-start`, `paused`, `resumed`, `serve`, `paddle-hit`, `wall-bounce`, `point` and `game-over`, each with the data an effect needs (where, how fast, which side, the rally count). Quiet steps share one frozen empty list, so they allocate nothing.

Events are plain data on the state rather than callbacks or an event bus. The domain stays pure, tests assert on events directly, and any number of adapters can react without the domain knowing they exist.

## 2. Application layer

`GameController` owns orchestration:

- start, restart, pause/resume, and back to the menu
- idempotent pause when the page loses focus
- advance one simulation step and hand its events to every feedback adapter
- apply the difficulty chosen in the preferences when a new match starts, never mid-match
- keep the best rally, and flag a record worth celebrating
- run the frame loop only while a match is running
- translate current state into presentation data

It talks to adapters through the ports declared in `src/application/ports.js`:

- `InputPort` — `snapshot()`, `onCommand(...)`
- `ViewPort` — `render(presentation)`, `onCommand(...)`
- `RendererPort` — `render(state)`
- `FeedbackPort` — `handle(events, state)`, implemented by the renderer's effects, the sound board and haptics
- `PreferencesPort` — `get()`, `set(changes)`
- `FrameScheduler` — `request(...)`, `cancel(...)`, injected into `FixedStepLoop`

The input, view, and renderer ports also expose `connect()` / `disconnect()`. The ports are JSDoc type definitions, and `npm run typecheck` uses the TypeScript compiler to verify that every adapter satisfies them and that the controller only uses what they promise. Commands are a closed set (`GAME_COMMAND`), so an unknown command is a type error instead of a silent no-op.

The controller therefore contains application policy without knowing whether the concrete UI is DOM, Canvas, keyboard, touch, speakers, or something else.

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

The loop is stopped whenever the match is not running, including from inside an update when the winning point is scored. Ready and paused screens are drawn once and then cost nothing.

## 4. Adapters

Browser-specific concerns live in `src/adapters/`.

### InputController

Translates pointer, touch, and keyboard input into device-neutral movement snapshots and commands. It listens on the whole game area but maps positions through the board, so the thumb rail below the court steers too. Its policy:

- keys are matched by physical code (`KeyA`, `KeyD`, arrows, `Space`, `Escape`), so layouts such as Ukrainian or AZERTY work
- combinations with `Ctrl`, `Meta` or `Alt` are left to the browser
- taps on buttons, or icons inside them, keep their meaning and do not move the paddle
- the most recently used device steers; a key press takes over from a resting mouse, and a horizontal pointer move or a tap takes over from the keyboard
- losing window focus or hiding the page releases held keys and sends an idempotent pause, because key-up events are lost while the page is unfocused

### DomGameView

Owns the HUD, the menu, pause and result overlays, and the settings. Controls declare their meaning in markup — `data-command`, `data-difficulty`, `data-setting` — so the view binds them generically. After a command it brings the court fully into view and hands focus back to the board, so `Space` controls the game instead of re-activating the focused button. It only writes to the DOM when the presentation changes, which keeps the `aria-live` status region from being rewritten every frame.

### CanvasRenderer and Effects

The renderer converts game state into pixels and implements `FeedbackPort`: game events become sparks, shockwave rings, screen shake, flashes, paddle squash, a grid pulse and victory fireworks, simulated by `Effects`, a small presentation-only particle system with injectable randomness.

It is built for phones:

- the court, grid, border glow and vignette are painted once into offscreen layers, and every glow is a pre-rendered sprite, so no frame uses the expensive `shadowBlur`
- light is drawn with additive blending, so overlapping sparks add up like neon
- the backing store matches the displayed size in device pixels, capped at twice the CSS size, and follows layout, zoom and pixel-ratio changes
- the ball trail and glow take the color of the last hitter and heat toward amber with speed
- pure white is reserved for the ball core and each paddle has a unique core color, so tests can find them in the pixels

While a match runs, the game loop drives every frame. After the match ends, the renderer requests its own frames until the fireworks settle, then stops. Paused screens freeze the effects. `prefers-reduced-motion` removes shake and softens flashes.

### SoundBoard

Implements `FeedbackPort` with Web Audio. Every sound is synthesized from oscillators at play time, with no audio files. Hit pitch climbs with the rally, and every fifth hit adds a chime. The audio context is created on the first event, which always follows a click or key press, as browsers require.

### Haptics

Implements `FeedbackPort` with `navigator.vibrate`: short pulses for the player's own hits, patterns for points and the end of a match. It is inert where vibration is unsupported, and the view hides the vibration switch there.

### LocalPreferences

Implements `PreferencesPort` over `localStorage`, validating everything it reads. Storage that is missing or throws, as in private browsing, falls back to in-memory values, so the game never breaks over storage.

### BrowserFrameScheduler

Wraps `requestAnimationFrame` / `cancelAnimationFrame` of the injected window. This small adapter keeps browser scheduling out of the application core.

## State ownership

There is one authoritative game state owned by `GameController`.

Adapters do not mutate game state. Domain functions return new state objects, keeping transitions explicit and inspectable. The renderer's effects are presentation state that the game never reads.

## Physics decisions

### Contact-position bounce

Outgoing direction depends on where the ball meets the paddle:

- center → mostly vertical return
- edge → greater horizontal component

Speed increases slightly after paddle contact and is capped so difficulty cannot grow without bound.

### Spin

A paddle's velocity is smoothed over a few steps, so a deliberate flick reads as speed while a single jittery sample does not. At impact, that velocity becomes spin. Spin turns the ball's direction toward its sign each step without changing its speed, fades over time, reverses at a wall so the ball curves away from it, and never leans the ball further from vertical than the steepest bounce angle, so a curve cannot stall a rally.

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

The opponent is designed to feel like a person rather than a wall:

- **reach:** it only reacts once the ball comes within a share of the court, and drifts back to the center otherwise
- **prediction:** it folds the ball's straight path at the side walls to find where it will cross its paddle, and trusts that prediction as much as its difficulty allows
- **misjudgement:** its error grows with ball speed and changes with every hit; it is derived from the rally state, so it stays deterministic
- **aim:** it meets the ball off-center so the return angles away from the player
- **no spin prediction:** a curved shot is the player's way past it

Prediction and physical ability remain separate: prediction chooses a target, and the speed cap limits how fast the paddle can reach it.

### Difficulty tuning

The three presets in `config.js` were tuned by simulating hundreds of matches against human-like bots of three skill levels. The bots have finger-speed limits, reaction delays, aim errors that grow with ball speed, and occasional flicks. The target was that a casual player wins almost every match on Easy, a confident one about two in three on Normal, and Hard is beaten mostly with curved shots. A unit test pins the ordering of the presets.

## Executable architecture constraints

Documentation can become stale, so the project encodes its rules as checks that fail CI:

- `eslint.config.js` — layer boundaries, no host globals or clock or randomness in the core, browser globals only in the composition root
- `tests/architecture-rules.test.js` — proves those lint rules still catch violations
- `tsconfig.json` + `npm run typecheck` — adapters satisfy the port contracts
- `scripts/check-project.mjs` — expected modules and assets exist, `script.js` stays a small composition root, no inline HTML event handlers

## Testing strategy

### Unit tests

The dependency-free unit suite targets deterministic rules and the logic of the adapters:

- domain: state machine and events, scoring, serves and the serve countdown, paddle control, collisions toward both paddles, spin and curves, the speed cap, the opponent, and a full rally
- application: loop lifecycle, interpolation, commands, difficulty per match, feedback dispatch, and best-rally records
- adapters: input, view, effects, sound, vibration and preferences, driven through fake event targets, fake audio contexts and fake storage thanks to injected globals
- architecture: the lint rules themselves

A coverage gate (95% lines, 90% branches and functions over `src/`) keeps it that way. The canvas renderer is covered by the browser tests.

### Browser tests

Playwright checks the assembled system on desktop and mobile Chromium. Instead of reaching into application state, the tests read the paddle and ball positions from the canvas pixels, and time-sensitive checks run on a paused fake clock. They run with reduced motion, so screen shake does not move the pixels they read; one test opts back into full motion to play a whole match with every effect. They cover:

- application boot without page errors, and state transitions through buttons and the keyboard
- mouse steering, the keyboard taking over from a resting mouse, and layout-independent keys
- the phone layout, the thumb rail, and the court staying in view with scrolling locked during a match
- the ball waiting at the center before the serve
- preferences surviving a reload, and the result screen after a full match
- auto-pause on focus loss, and an idle render loop outside of a match
- a canvas backing store that matches device pixels, and an installable manifest

The goal is not to duplicate every domain test in a browser. Browser tests cover integration seams; unit tests cover rule permutations.

## Deliberate omissions

The project does not add:

- React or another UI framework
- a game engine, physics engine or audio library
- Redux/global state tooling or an event bus
- a dependency-injection library
- a repository/service abstraction with no external resource
- a bundler or a compile step
- a backend or a service worker

Those tools would increase surface area without solving current requirements.

## Extension points

The boundaries make future changes local:

- tune or add difficulties → `config.js`
- change the opponent's personality → `domain/opponent.js`
- new effects or sounds for an event → the renderer's or sound board's `handle`, without touching the game
- randomize serves → inject a seeded random source, keeping the core deterministic
- replace Canvas → another `RendererPort` adapter
- add gamepad support → another `InputPort` adapter
- add a second human player → input mapping + domain command
- add replay/debug snapshots → record the event stream without rewriting physics

The architecture exists to make change predictable, not to maximize the number of files.
