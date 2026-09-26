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
   +--> adapters/canvas-renderer.js ──> adapters/canvas/*, adapters/effects.js
   +--> adapters/sound-board.js ──┐
   +--> adapters/music-player.js ─┴──> adapters/audio-output.js
   +--> adapters/haptics.js
   +--> adapters/wake-lock.js
   +--> adapters/browser-device.js
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
                           +--> domain/power-ups.js ──> domain/random.js
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
- the rules of a match (first to a score, with match point) and of a Rush run (lives that the player's misses spend; the computer never wins a point)
- score transitions, win condition, and winner
- the serve countdown: three seconds counted aloud before the first serve, a short pause before every later one, while the paddles can already move
- rallies: hits since the serve, the longest rally of the match, and every side's total hits
- power-ups: when one appears, what it does to whom, and how long it lasts
- a second human on the top paddle, when the rules say the opponent is human
- paddle bounds and smoothed paddle velocity
- ball movement, wall reflection, swept contact between the ball and a paddle's face, corners and sides, bounce angles and speed progression
- spin, and the curve it puts on the ball
- the computer opponent

The domain accepts plain data and returns new state. It does not draw, play sounds, register listeners, query the DOM, schedule frames, read the clock, or know which device produced an input command. The shapes it works with (`GameState`, `GameConfig`, `InputSnapshot`, `GameEvent`, `Rules`, `Pickup`) are declared once in `src/domain/types.js`.

That makes the highest-value behavior directly testable with Node's built-in test runner, and fully deterministic: the same inputs always produce the same match.

### Randomness without losing determinism

Power-ups need chance: what kind appears, where, and when. The core is forbidden `Math.random`, so `domain/random.js` is a small seeded generator whose state lives in `GameState.seed`. Every draw returns the value and the next seed, and the composition root hands each match a fresh seed. The result is the best of both: matches differ, yet any match replays exactly from its seed and inputs, and a test can pin a specific outcome.

### Rules as data

`GameConfig.rules` is either `{ kind: 'match', winningScore }` or `{ kind: 'rush', lives }`. The simulation is the same for both; only `awardPoint` consults the rules to decide whether a point ends the match, costs a life, or announces match point. Adding a mode means adding a rules variant, not a second game.

### Game events

Every transition lists what happened in `state.events`: `match-start`, `menu`, `paused`, `resumed`, `countdown`, `serve`, `paddle-hit`, `paddle-graze`, `wall-bounce`, `pickup-spawn`, `pickup`, `point`, `match-point`, `life-lost` and `game-over`, each with the data an effect needs (where, how fast, which side, the rally count). Quiet steps share one frozen empty list, so they allocate nothing.

Events are plain data on the state rather than callbacks or an event bus. The domain stays pure, tests assert on events directly, and any number of adapters can react without the domain knowing they exist.

## 2. Application layer

`GameController` owns orchestration:

- start, restart, pause/resume, and back to the menu
- idempotent pause when the page loses focus
- advance one simulation step and hand its events to every feedback adapter
- build the match from the mode, difficulty and options chosen in the preferences when a new match starts, never mid-match (`buildMatchConfig`)
- tell the input adapter how many people are steering
- drama: a short hit-stop on hard hits, and slow motion while a match-point ball closes on a paddle
- keep the best rally (a Solo record), the best Rush run and the Solo win statistics, and flag a record worth celebrating; records are read fresh from the preferences, which another tab may have raised
- count leaving a Solo match after its first point as a loss, so quitting cannot protect a winning streak
- run the frame loop only while a match is running
- translate current state into presentation data

It talks to adapters through the ports declared in `src/application/ports.js`:

- `InputPort` — `snapshot()`, `onCommand(...)`
- `ViewPort` — `render(presentation)`, `onCommand(...)`
- `RendererPort` — `render(state, config)`, so the renderer draws the match's own paddle widths and speeds
- `FeedbackPort` — `handle(events, state)`, implemented by the renderer's effects, the sound board, the music player, haptics and the wake lock
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

The loop also owns two knobs for drama, both of which leave the simulation's step size untouched: a **time scale** stretches real time before it is accumulated, so slow motion runs the same fixed steps more slowly, and a **hold** swallows a few real milliseconds without simulating them, for the classic freeze on a hard hit. Rendering keeps going through both.

The loop is stopped whenever the match is not running, including from inside an update when the winning point is scored. Ready and paused screens are drawn once and then cost nothing.

## 4. Adapters

Browser-specific concerns live in `src/adapters/`.

### InputController

Translates pointer, touch, and keyboard input into device-neutral movement snapshots and commands. It listens on the whole game area but maps positions through the board, so the thumb rail below the court steers too. With two players it splits the board: a finger that lands on the top half takes the top paddle, and each finger keeps the paddle it started on until it lifts, so two hands crossing the middle never swap paddles. Its policy:

- keys are matched by physical code (`KeyA`, `KeyD`, arrows, `Space`, `Escape`; `KeyJ`, `KeyL` and the numpad for a second player), so layouts such as Ukrainian or AZERTY work
- combinations with `Ctrl`, `Meta` or `Alt` are left to the browser
- taps on buttons, or icons inside them, keep their meaning and do not move the paddle
- the most recently used device steers; a key press takes over from a resting mouse, and a horizontal pointer move or a tap takes over from the keyboard
- losing window focus or hiding the page releases held keys and sends an idempotent pause, because key-up events are lost while the page is unfocused

### DomGameView

Owns the HUD, the menu with its modes, the tutorial, pause and result overlays, and the settings. Controls declare their meaning in markup — `data-command`, `data-mode`, `data-difficulty`, `data-setting` — so the view binds them generically. It hands sharing and full screen to `BrowserDevice`, hiding those buttons where the browser lacks the feature. It only writes to the DOM when the presentation changes, which keeps the `aria-live` status region from being rewritten every frame, and it never repeats the rules from memory: the menu line is built from the rules in the presentation.

Focus is managed deliberately:

- the tutorial is a native `<dialog>` opened with `showModal()`, once on a first visit: the page behind it is inert, focus starts on its button and `Escape` closes it; `InputController` ignores game keys and touches while any dialog is open, so `Space` presses the dialog's button instead of starting a match behind it
- the pause and result screens are labelled dialogs whose main button takes focus when they appear; play hands focus back to the board, unless the player had moved it elsewhere on the page
- after a command button, focus returns to the board, so `Space` controls the game instead of re-activating the button

### CanvasRenderer and Effects

The renderer converts game state into pixels and implements `FeedbackPort`: game events become sparks, shockwave rings, screen shake, flashes, paddle squash, a grid pulse and victory fireworks, simulated by `Effects`, a small presentation-only particle system with injectable randomness.

`canvas-renderer.js` only owns the canvas, its size and its frames. What a frame contains lives in `src/adapters/canvas/`: `theme.js` (colors and shared helpers), `court.js` (the pre-rendered court and glow sprites), `scene.js` (ball, trail, paddles, power-ups, the Ghost fog), `hud.js` (countdown, rally counter, callouts), `ball-trail.js` and `event-effects.js` (the visual side of each game event). Each is unit-tested against a recording 2D context.

It is built for phones:

- the court, grid, border glow and vignette are painted once into offscreen layers, and every glow is a pre-rendered sprite, so no frame uses the expensive `shadowBlur`
- light is drawn with additive blending, so overlapping sparks add up like neon
- the backing store matches the displayed size in device pixels, capped at twice the CSS size, and follows layout, zoom and pixel-ratio changes
- the ball trail and glow take the color of the last hitter and heat toward amber with speed
- pure white is reserved for the ball core and each paddle has a unique core color, so tests can find them in the pixels

While a match runs, the game loop drives every frame. After the match ends, the renderer requests its own frames until the fireworks settle, then stops. Paused screens freeze the effects. `prefers-reduced-motion` removes shake and softens flashes.

### SoundBoard and MusicPlayer

Both implement `FeedbackPort` with Web Audio, and every sound is synthesized from oscillators at play time, with no audio files. The sound board plays effects: hit pitch climbs with the rally, every fifth hit adds a chime, and the countdown, power-ups, match point and a lost life each have their own cue. The music player runs a four-bar loop scheduled ahead of the clock, so timing stays exact whatever the frame rate; it starts with bass alone, adds a chord layer at three hits and a lead line at six, fades on pause, stops at the menu, and starts every match from the bass again. Both play through one audio context, owned by `AudioOutput`: browsers limit how many a page may open, so it is created once, on the first event, which always follows a click or key press, and resumed whenever the browser suspended it.

### Haptics

Implements `FeedbackPort` with `navigator.vibrate`: short pulses for the player's own hits, patterns for points and the end of a match. It is inert where vibration is unsupported, and the view hides the vibration switch there.

### WakeLock and BrowserDevice

`WakeLock` implements `FeedbackPort` with the Screen Wake Lock API: a thumb on a rail sends no key or scroll events, so without it the phone would dim mid-rally. It holds the lock only while a match runs, and keeps at most one request in flight, so a pause and resume during a request cannot leave a second lock unreleased. `BrowserDevice` wraps the Web Share API, with the clipboard as a fallback, and the Fullscreen API. Closing the share sheet is respected rather than turned into a silent copy, and a copy is reported only when it happened.

### LocalPreferences

Implements `PreferencesPort` over `localStorage`, validating everything it reads. Storage that is missing or throws, as in private browsing, falls back to in-memory values, so the game never breaks over storage.

The game may be open in several tabs. Each tab follows the others' saves through the `storage` event, and merges its own changes into what is stored at that moment, so one tab never writes back another's older records. After a save fails, a tab trusts its own newer values over storage.

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

### Swept paddle contact

A simple overlap check misses a paddle when a fast ball travels past it between simulation samples. An earlier version solved that by testing only the moment the ball's leading edge crossed the paddle's face plane, but then a ball that reached the plane just wide of the paddle and drifted into its corner or side, or a paddle swept sideways into a ball beside it, went straight through: 4 to 6% of missed points in bot simulations.

`findPaddleContact` works in the paddle's frame of reference, where the paddle stands still and the ball's path over one step, the paddle's own motion included, is a straight segment. The ball's center must not enter the paddle rectangle grown by the ball's radius, whose corners are rounded: two crossed rectangles and four corner circles. The earliest entry into any of them is the first touch, and the surface normal there tells face, corner and side apart.

- the face and the front corners return the ball, from the very edge when a corner is clipped, and the return leaves level with the face, so a paddle sliding on cannot catch it twice
- the sides and back corners deflect it like a moving wall (`paddle-graze`), keeping its progress toward the goal, and the point still goes to the other side
- a ball squeezed between a paddle and a side wall slips out behind the paddle

A property test plays 60 bot matches across every mode, over 100,000 steps with yanked paddles, and asserts that the ball never overlaps a paddle. The difficulty balance, measured with the same bots before and after the change, moved only within noise.

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
- `scripts/coverage-gate.mjs` — coverage over the whole of `src/` and over every file on its own
- `scripts/check-project.mjs` — expected modules and assets exist, `script.js` stays a small composition root, no inline HTML event handlers

## Testing strategy

### Unit tests

The dependency-free unit suite targets deterministic rules and the logic of the adapters:

- domain: state machine and events, the match and Rush rules, scoring and match point, the countdown and serve pauses, paddle control for one or two people, paddle contact on faces, corners and sides with a no-overlap property test, spin and curves, the speed cap, the opponent, power-ups, the random source, and a full rally
- application: loop lifecycle with time scale and hold, interpolation, commands, the match built per mode, drama, feedback dispatch, the rally, Rush and win-streak records, and forfeits
- adapters: input with two-player halves and dialogs, the view with modes, the modal tutorial and focus, the canvas renderer and its modules, effects and callouts, sound and music on one audio context, vibration, the wake lock, sharing and full screen, and preferences across tabs, driven through fake event targets, a recording 2D context, fake audio contexts and fake storage thanks to injected globals
- architecture: the lint rules themselves, and that every module loads without a browser

`tests/modules-load.test.js` loads every module under `src/`, so a file no test exercises counts at 0% instead of being left out. The coverage gate then holds the whole of `src/` to 95% lines and 90% branches and functions, and every file on its own to 90% lines, 85% branches and 80% functions, so no module can hide behind the average.

### Browser tests

Playwright checks the assembled system on desktop and mobile Chromium. Instead of reaching into application state, the tests read the paddle and ball positions from the canvas pixels, and time-sensitive checks run on a paused fake clock. They run with reduced motion, so screen shake does not move the pixels they read; one test opts back into full motion to play a whole match with every effect. They cover:

- application boot without page errors, and state transitions through buttons and the keyboard
- mouse steering, the keyboard taking over from a resting mouse, and layout-independent keys
- the phone layout, the thumb rail, and the court staying in view with scrolling locked during a match
- the three-second countdown before the first serve
- the first-visit tutorial as a modal dialog: `Space` closes it without starting a match, `Escape` closes it too, and either is remembered
- Rush lives running out, and two players steering their own halves of the board
- the heads-up display fitting a 320px-wide phone without sideways scrolling
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
- add a mode → a `Rules` variant in `domain/types.js` and a preset in `config.js`
- add a power-up → a kind in `domain/power-ups.js`, its look in `adapters/canvas/theme.js`, its sound in the sound board
- change the opponent's personality → `domain/opponent.js`
- new effects or sounds for an event → `adapters/canvas/event-effects.js` or the sound board, without touching the game
- randomize serves → draw from the seeded random source already in the state, keeping the core deterministic
- replace Canvas → another `RendererPort` adapter
- add gamepad support → another `InputPort` adapter
- add replay/debug snapshots → record the event stream without rewriting physics

The architecture exists to make change predictable, not to maximize the number of files.
