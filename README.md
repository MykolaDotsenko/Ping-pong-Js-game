# Ping Pong Architecture Lab

[![Quality](https://github.com/MykolaDotsenko/Ping-pong-Js-game/actions/workflows/quality.yml/badge.svg)](https://github.com/MykolaDotsenko/Ping-pong-Js-game/actions/workflows/quality.yml)

A dependency-free browser Ping Pong game built as a compact **software architecture case study**.

The project deliberately stays on Vanilla JavaScript and Canvas so the engineering decisions remain visible: explicit dependency direction, browser-agnostic core logic, deterministic simulation, replaceable adapters, and automated verification.

**[Live demo on GitHub Pages](https://mykoladotsenko.github.io/Ping-pong-Js-game/)**

![Ping Pong Architecture Lab preview](./docs/preview.svg)

## Why this project exists

This is not an attempt to build the largest Pong implementation. It demonstrates how to apply proportional architecture to a small product without hiding complexity behind a framework.

The original 2024 version used one global script for rendering, input, physics, AI, scoring, and lifecycle. The current version separates those concerns and makes the important rules independently testable.

## What it demonstrates

- browser-agnostic **domain + application core**, kept deterministic (no clock, no randomness)
- explicit state machine: `ready → running ↔ paused → game-over`
- fixed-timestep simulation with render interpolation, independent from display refresh rate
- a render loop that runs only during a match; idle screens cost no frames
- swept paddle collision using the exact crossing point
- paddle-hit angle derived from contact position
- speed-capped opponent strategy with lightweight prediction
- typed ports: adapter contracts written as JSDoc and checked by the TypeScript compiler, with no build step
- input, DOM view, Canvas rendering, and frame scheduling as adapters that receive browser globals by injection
- one authoritative state owner
- layer boundaries enforced by ESLint, with tests proving the rules still reject violations
- unit tests for domain rules, the application controller, and the input and view adapters, behind a coverage gate
- Playwright tests on desktop and mobile Chromium that assert on the rendered canvas
- responsive semantic shell with keyboard, pointer, and touch controls and a sharp canvas on high-density screens

## Stack

- semantic HTML5
- modern CSS
- Vanilla JavaScript with native ES modules
- Canvas 2D
- Node.js built-in test runner and coverage
- ESLint 10
- TypeScript 7, for JSDoc type-checking only
- Playwright Test 1.63
- GitHub Actions

There is intentionally **no React, game engine, state library, dependency-injection framework, bundler, or runtime dependency**. Those tools would add surface area without solving a requirement in this product. TypeScript only checks the JavaScript that ships; nothing is compiled.

## Architecture

```text
Browser shell
    |
script.js (composition root: the only place that touches browser globals)
    |
    +-- InputController ------------ browser input adapter
    +-- DomGameView ---------------- DOM output/command adapter
    +-- CanvasRenderer ------------- Canvas output adapter
    +-- BrowserFrameScheduler ------ timing adapter
    |
    +-- GameController ------------- application orchestration
            |
            +-- ports -------------- adapter contracts and commands
            +-- FixedStepLoop ------- deterministic timing policy
            +-- interpolateState ---- smooth rendering between steps
            |
            +-- domain/game
                    |
                    +-- physics
                    +-- opponent strategy
```

**Dependency rule:** browser details depend on the core; the core never depends on browser APIs.

ESLint enforces the rule per directory: the domain and application layers see no host globals, cannot read the clock or `Math.random`, and cannot import outward. `tests/architecture-rules.test.js` feeds violations to ESLint to prove the rules keep working.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the design rationale and trade-offs.

## Project structure

```text
.
├── .github/workflows/quality.yml
├── docs/preview.svg
├── e2e/game.spec.js
├── scripts/check-project.mjs
├── src
│   ├── adapters
│   │   ├── browser-frame-scheduler.js
│   │   ├── canvas-renderer.js
│   │   ├── dom-game-view.js
│   │   └── input-controller.js
│   ├── application
│   │   ├── game-controller.js
│   │   ├── game-loop.js
│   │   ├── interpolation.js
│   │   └── ports.js
│   ├── domain
│   │   ├── game.js
│   │   ├── opponent.js
│   │   ├── physics.js
│   │   └── types.js
│   └── config.js
├── tests
│   ├── architecture-rules.test.js
│   ├── dom-game-view.test.js
│   ├── game.test.js
│   ├── game-controller.test.js
│   ├── game-loop.test.js
│   ├── input-controller.test.js
│   ├── interpolation.test.js
│   ├── opponent.test.js
│   └── physics.test.js
├── ARCHITECTURE.md
├── LICENSE
├── eslint.config.js
├── index.html
├── package.json
├── package-lock.json
├── playwright.config.js
├── script.js
├── style.css
└── tsconfig.json
```

## Run locally

The game itself has no runtime installation step. Because it uses native ES modules, serve the directory over HTTP:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

For quality tooling:

```bash
npm ci
npm run check
npx playwright install chromium
npm run test:e2e
```

## Controls

- pointer / mouse / touch — move the player paddle; a tap moves it straight to that spot
- `←` / `→` — keyboard movement
- `A` / `D` — keyboard movement, matched by physical key so it works on any layout, including Ukrainian and AZERTY
- `Space` — start or pause/resume

Whichever device you used last steers the paddle, so the keyboard works even while the mouse rests on the board. Clicking a button hands focus back to the board, so `Space` keeps working. The match pauses by itself when the window loses focus or the tab is hidden. Browser shortcuts such as `Ctrl+A` are never intercepted.

First to 7 wins.

## Verification strategy

### Static and structural checks

`npm run check` runs:

1. ESLint, including the per-directory architecture boundaries
2. TypeScript type-checking of the JSDoc-annotated sources
3. unit tests with a coverage gate (95% lines, 90% branches and functions)
4. project-structure checks

### Unit tests

The dependency-free unit suite covers:

- state-machine transitions, including idempotent auto-pause
- scoring, win condition, and double-score prevention
- serve direction
- paddle clamping, keyboard speed, and direct pointer placement
- wall reflection on both sides
- center/off-center paddle bounce and the speed cap
- swept collision toward both paddles
- a full deterministic rally that exercises both paddles until the ball reaches top speed
- opponent target, dead zone, and speed limit
- the fixed-step loop, including stopping from inside an update
- render interpolation, including serves that must not be blended
- the controller: loop lifecycle per phase, commands, status text, and the final frame of a match
- the input adapter: layouts, modifier shortcuts, device switching, taps, and focus loss
- the view adapter: focus hand-off, phase-dependent controls, and quiet live-region updates
- the architecture rules themselves

### Browser tests

Playwright runs the real application in desktop and mobile Chromium. It reads the player paddle's position from the canvas pixels, so the tests assert on what the player actually sees. They verify:

- the application boots without page errors
- Start, Pause, Reset, and `Space` drive the state machine, including `Space` right after a mouse click
- the paddle follows the mouse, and the keyboard takes over while the mouse rests on the board
- `A`/`D` steer when the keyboard layout produces Cyrillic characters
- a tap moves the paddle on touch screens
- losing window focus pauses the match
- idle screens request no animation frames and leave the live region untouched
- the canvas backing store matches the screen's device pixels

## Architecture trade-offs

A tiny game does not justify enterprise layers. Every boundary here solves a concrete problem:

- physics must be testable without Canvas
- the application core must not know about the browser
- input devices must not mutate state directly
- refresh rate must not control simulation speed
- browser frame scheduling must be replaceable
- rendering must not decide scoring or collisions
- dependencies must remain obvious at the composition root

The project deliberately avoids repositories, factories, event buses, service locators, and other abstractions that would not reduce a real coupling.

## Recruiter walkthrough

If you have two minutes, inspect these files in order:

1. [`script.js`](./script.js) — composition root and dependency wiring
2. [`src/application/ports.js`](./src/application/ports.js) — the contracts adapters implement
3. [`src/application/game-controller.js`](./src/application/game-controller.js) — orchestration without browser APIs
4. [`src/domain/game.js`](./src/domain/game.js) — state transitions and scoring
5. [`src/domain/physics.js`](./src/domain/physics.js) — swept collision and bounce rules
6. [`eslint.config.js`](./eslint.config.js) — executable architecture constraints
7. [`.github/workflows/quality.yml`](./.github/workflows/quality.yml) — automated verification

## License

[MIT](./LICENSE)

## Author

Mykola Dotsenko
