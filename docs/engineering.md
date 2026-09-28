# Paddle Noir — Engineering Notes

## Architecture

```text
Browser shell
    |
script.js (composition root: the only place that touches browser globals)
    |
    +-- InputController ------------ pointer, touch rail and keyboard input
    +-- DomGameView ---------------- HUD, menus and settings around the board
    +-- CanvasRenderer ------------- neon rendering and visual effects (canvas/*)
    +-- SoundBoard ----------------- synthesized sound effects  ─┐
    +-- MusicPlayer ---------------- a backing track that builds ┴─ AudioOutput (one context)
    +-- Haptics -------------------- vibration
    +-- WakeLock ------------------- keeps the screen on during a match
    +-- BrowserDevice -------------- sharing and full screen
    +-- LocalPreferences ----------- mode, difficulty, settings and records
    +-- BrowserFrameScheduler ------ timing
    |
    +-- GameController ------------- application orchestration
            |
            +-- ports -------------- adapter contracts and commands
            +-- FixedStepLoop ------- deterministic timing policy
            +-- interpolateState ---- smooth rendering between steps
            |
            +-- career -------------- stars, the open part of the ladder, tired rivals
            |
            +-- domain/game --------- state machine, rules, scoring, events
                    |
                    +-- physics ----- swept paddle contact, bounce angles, spin
                    +-- opponent ---- reach, prediction, aim, misjudgement
                    +-- power-ups --- pickups, effects, Multiball, a seeded random source
                    +-- supers ------ the super meters and the four super shots
                    +-- hazards ----- a career boss's drips, beams and lag, and the final boss's phases
```

**Dependency rule:** browser details depend on the core; the core never depends on browser APIs.

ESLint enforces the rule per directory: the domain and application layers see no host globals, cannot read the clock or `Math.random`, and cannot import outward. `tests/architecture-rules.test.js` feeds violations to ESLint to prove the rules keep working.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the design rationale and trade-offs.

## Project structure

```text
.
├── .github/workflows/quality.yml   checks on every push and PR; deploys main to GitHub Pages
├── docs/preview.png
├── e2e/game.spec.js
├── icons/                      app icons, rendered from icon.svg
├── scripts
│   ├── capture-preview.mjs
│   ├── check-project.mjs
│   ├── coverage-gate.mjs
│   ├── render-icons.mjs
│   └── verify-live-site.mjs    after a deploy: every published file served byte for byte
├── src
│   ├── adapters
│   │   ├── canvas
│   │   │   ├── ball-trail.js
│   │   │   ├── court.js
│   │   │   ├── event-effects.js
│   │   │   ├── hud.js
│   │   │   ├── scene.js
│   │   │   └── theme.js
│   │   ├── audio-output.js
│   │   ├── browser-device.js
│   │   ├── browser-frame-scheduler.js
│   │   ├── canvas-renderer.js
│   │   ├── dom-game-view.js
│   │   ├── effects.js
│   │   ├── finisher.js
│   │   ├── haptics.js
│   │   ├── input-controller.js
│   │   ├── local-preferences.js
│   │   ├── music-player.js
│   │   ├── music-tracks.js
│   │   ├── sound-board.js
│   │   └── wake-lock.js
│   ├── application
│   │   ├── career.js
│   │   ├── game-controller.js
│   │   ├── game-loop.js
│   │   ├── interpolation.js
│   │   ├── nicknames.js
│   │   └── ports.js
│   ├── domain
│   │   ├── game.js
│   │   ├── hazards.js
│   │   ├── opponent.js
│   │   ├── physics.js
│   │   ├── power-ups.js
│   │   ├── random.js
│   │   ├── supers.js
│   │   └── types.js
│   ├── catalog.js              the matches a player can choose, the career ladder included
│   └── config.js
├── tests                       unit tests per module, reference matches, collision and module-load checks, support/ fakes
├── ARCHITECTURE.md
├── LICENSE
├── eslint.config.js
├── index.html
├── manifest.webmanifest
├── package.json
├── package-lock.json
├── playwright.config.js
├── script.js
├── style.css
└── tsconfig.json
```

## Verification strategy

### Static and structural checks

`npm run check` runs:

1. ESLint, including the per-directory architecture boundaries
2. TypeScript type-checking of the JSDoc-annotated sources
3. unit tests with a coverage gate: 95% lines and 90% branches and functions over all of `src/`, and at least 90% lines, 85% branches and 80% functions in every single file
4. project-structure checks

### Unit tests

The dependency-free unit suite covers:

- the state machine, scoring, serves, the 3-2-1 countdown, match point, and the events every transition emits
- the Rush rules (lives, hits, no win condition for the computer) and two-player steering of the top paddle
- power-ups: spawning on schedule, each effect, wear-off through serve pauses, the computer's blindness to a ghosted ball, and Multiball's split-off balls, which bounce, score and fade but stay out of the rally
- supers: the meter's charge for a return, an edge, a curve, a save and a lost point; a full meter's super, drawn and never the last one; firing by a flick or, for the computer, by chance; each super's flight; a saved super's return at the rally's pace; a phantom the computer can only guess at; and points and matches named after the super that won them
- a career boss's attacks: drips aimed at the player, a beam announced before it strikes, lag, a hit that only shrinks the paddle for a while, and attacks that never overlap and stop at a point; the final boss's phases, which follow the player's score, announce themselves, and draw from all three attacks at the end, while every other boss draws exactly as before
- the reference matches: eight recorded bot matches, Solo on every difficulty, keyboard steering, Rush, two players, power-ups and supers, replayed step by step against their digests
- the deterministic random source, so a seed replays a match
- paddle control, the speed cap, spin from a moving paddle, curves that keep their speed and never stall a rally, and a full deterministic rally
- paddle contact: faces, clipped corners, sides, a paddle run into a missed ball or yanked toward a wall, a paddle that flashes across under the ball, fast balls at any speed, and a property test over 60 bot matches in which the ball never overlaps a paddle
- the opponent's reach, wall-folded prediction, aim, speed-dependent misjudgement, and the ordering of the difficulty presets
- the fixed-step loop with its time scale and hit-stop hold, and render interpolation
- the controller: loop lifecycle, commands, the match built from mode and difficulty, slow motion and hit-stop, event dispatch to feedback adapters, the best-rally, best-Rush and win-streak records, forfeits, and the career: its stars, the ladder moving on after a win, tired rivals after two losses, and records kept apart from Solo
- the career ladder: ten rivals, four bosses, the last the final boss who borrows the other bosses' attacks, a story and a short name each, and every rival playing a real match
- the adapters: input (layouts, shortcuts, device switching, the thumb rail, focus loss, dialogs), the view (overlays, the modal tutorial and settings, focus, rules from config, quiet live-region updates, the rival picker, the finisher's wait and the countdown), the canvas renderer and its modules on a recording 2D context, effects, sound and music on one audio context, vibration, the wake lock, sharing and full screen, and preferences across tabs
- the architecture rules themselves, and that every module loads without a browser

### Browser tests

Playwright runs the real application in desktop and mobile Chromium. It reads the paddle and ball positions from the canvas pixels, so the tests assert on what the player actually sees, and time-sensitive checks run on a paused fake clock. They verify:

- the application boots without page errors, and Play, `Space`, `Esc` and the menus drive the state machine
- the paddle follows the mouse, the keyboard takes over while the mouse rests on the board, and `A`/`D` work on a Cyrillic layout
- on a phone, the court fills the screen, stays in view when a match starts, and the thumb rail steers the paddle; on a 320px-wide phone the heads-up display fits without sideways scrolling and every control of the menu and pause screen is fingertip-sized; held sideways, the HUD stands beside a full-height court and the menu sheet fits
- the first serve counts down from three before the ball moves
- the first visit opens the tutorial once as a modal dialog; `Space` closes it without starting a match, `Esc` closes it too, and either is remembered; the settings open the same way, and closing them starts nothing
- the title screen keeps the score, the pause button and the thumb rail back until a match starts, and the court does not move when they appear
- Rush shows lives as hearts and ends when they run out; two players get their own halves of the board
- mode, difficulty, power-up, super and sound choices survive a reload; the Supers switch says where it applies, and the super meter shows in the corner of the court only while supers are on
- a lost match ends on the result screen, with full effects and no page errors, and Play again starts a new one
- the computer's nickname follows the Fun switch; a won match ends with a Pongality before the result screen, which a tap or a key brings at once without starting the next match
- the career opens as far as the rivals beaten, names the rival as a match starts, the first boss's drip shrinks a paddle that stands still, the landlord waits at the top as the final boss, and a lost match counts down to game over
- losing window focus pauses the match, and idle screens request no animation frames
- the canvas matches device pixels up to twice the CSS size, and the app is installable

## Architecture trade-offs

A small game does not justify enterprise layers. Every boundary here solves a concrete problem:

- physics and the opponent must be testable without Canvas
- the application core must not know about the browser
- input devices must not mutate state directly
- refresh rate must not control simulation speed
- sound, vibration and visual effects must react to the game without the game knowing they exist
- rendering must not decide scoring or collisions
- dependencies must remain obvious at the composition root

The project deliberately avoids repositories, factories, event buses, service locators, and other abstractions that would not reduce a real coupling. Game events are plain data on the state, handed to a list of feedback adapters.

