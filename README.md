# Ping Pong Architecture Lab

A dependency-free browser Ping Pong game built as a compact **software architecture case study**.

The original 2024 single-file learning project has been refactored without replacing Vanilla JavaScript with a framework. The current version focuses on explicit boundaries, deterministic simulation, testable domain rules, and proportional architecture.

## What it demonstrates

- pure game/domain logic separated from browser APIs
- explicit game state machine: `ready → running ↔ paused → game-over`
- fixed-timestep simulation independent from display refresh rate
- previous/current-position collision checks to reduce high-speed tunneling
- paddle-hit angle derived from contact position
- speed-capped opponent strategy with lightweight prediction
- pointer/touch and keyboard input through one adapter
- Canvas rendering as a replaceable output adapter
- one authoritative state owner
- dependency-free unit tests with Node's built-in test runner
- GitHub Actions quality gate
- accessible semantic application shell and reduced-motion support

## Stack

- semantic HTML5
- modern CSS
- Vanilla JavaScript with native ES modules
- Canvas 2D
- Node.js built-in test runner
- GitHub Actions

There is intentionally **no React, game engine, bundler, state library, or runtime dependency**. For this product, those tools would hide rather than demonstrate the architectural decisions.

## Architecture

```text
Browser shell
    |
script.js (composition root)
    |
    +-- input adapter
    +-- Canvas renderer adapter
    +-- game controller
            |
            +-- fixed-step loop
            +-- domain/game
                    |
                    +-- physics
                    +-- opponent strategy
```

The dependency rule is simple: **browser details depend on game rules; game rules never depend on the browser**.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the rationale and trade-offs.

## Project structure

```text
.
├── .github/workflows/quality.yml
├── scripts/check-project.mjs
├── src
│   ├── adapters
│   │   ├── canvas-renderer.js
│   │   └── input-controller.js
│   ├── application
│   │   ├── game-controller.js
│   │   └── game-loop.js
│   ├── domain
│   │   ├── game.js
│   │   ├── opponent.js
│   │   └── physics.js
│   └── config.js
├── tests
│   ├── game.test.js
│   └── physics.test.js
├── ARCHITECTURE.md
├── index.html
├── package.json
├── script.js
└── style.css
```

## Run locally

No install step is required for the game itself.

Because the app uses native ES modules, serve the directory over HTTP:

```bash
python -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

## Controls

- pointer / mouse / touch — move the player paddle
- `←` / `→` — keyboard movement
- `A` / `D` — keyboard movement
- `Space` — start or pause/resume

First to 7 wins.

## Quality checks

Node.js 20+:

```bash
npm test
npm run check
```

The checks cover game-state transitions, scoring, game over, paddle boundaries, wall reflection, paddle bounce behavior, required project structure, the ES-module entry point, and the rule that the composition root stays thin.

## Why this architecture is intentionally small

A tiny game does not justify enterprise layers. The refactor adds only boundaries that solve a concrete problem:

- physics should not depend on Canvas;
- input devices should not mutate game state directly;
- refresh rate should not control simulation speed;
- scoring and collision rules should be testable without a browser;
- dependencies should be visible at the composition root.

The result is more code than one global script, but each module has a reason to exist and an obvious change boundary.

## Author

Mykola Dotsenko
