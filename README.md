# Paddle Noir

[![Quality](https://github.com/MykolaDotsenko/paddle-noir/actions/workflows/quality.yml/badge.svg)](https://github.com/MykolaDotsenko/paddle-noir/actions/workflows/quality.yml)

**Paddle Noir** is a neon arcade ping pong game for phones and desktops, built without dependencies as a compact **software architecture case study**.

The project deliberately stays on Vanilla JavaScript, Canvas and Web Audio so the engineering decisions remain visible: explicit dependency direction, browser-agnostic core logic, deterministic simulation, replaceable adapters, and automated verification.

**[Play the live demo](https://mykoladotsenko.github.io/paddle-noir/)**. On a phone, add it to your home screen for full-screen play.

![The Paddle Noir title screen beside a live match](./docs/preview.png)

The preview shows the title screen and a real frame of a live match, both captured from the running app by `npm run docs:preview`, identically on every run.

## Why this project exists

This is not an attempt to build the largest Pong implementation. It demonstrates how to apply proportional architecture to a small product without hiding complexity behind a framework, and how far a small, well-structured core can be pushed in feel and polish.

The original 2024 version used one global script for rendering, input, physics, AI, scoring, and lifecycle. The current version separates those concerns and makes the important rules independently testable.

## The game

- **Four ways to play.** **Solo** against the computer, first to 7. **Rush**, a survival run with three lives against a computer that returns everything but a curve, where the ball only gets faster and your score is the number of hits. **2P**, two people on one phone, each steering their own end of the court. **Career**, the ladder below.
- **Career: The Last Arcade.** Nine regulars of the last arcade in town, each with a style and a line of story: Rookie Roma, Aunt Halyna and her wide paddle, Twisty Taras whose returns all curve, Hoarder Hryts and his power-ups, corner-sniping Sniper Sanya, Grandmaster Zina, and three bosses who fight dirty. **The Janitor** drips on your end of the court, **DJ Wobble** strikes a column of it with a beam, and **LAG**, the router in the back room, makes the balls move in fits and starts. Every attack is announced a moment before it lands, and a hit only shrinks your paddle for a few seconds. At the top waits the final boss, **The Landlord**, who wants a parking lot where the arcade stands. Like a fighting game's last boss he fights with the moves of those you beat on the way, one after another as you close in on winning: his building's leaky roof drips, its bad wiring throws a beam, its bad Wi-Fi lags, and at your match point the **FINAL NOTICE** brings all three. His paddle glows with the phase he is in, and the match opens with **FIGHT!**. A win earns up to three stars and opens the next rival; a rival that beats you twice in a row plays tired. Beating the landlord keeps the arcade open. All the names are made up.
- **Super shots.** Your returns fill a meter in your corner of the court, faster off the paddle's edge, with curve, or when you return one of the other side's supers, and a lost point helps you back. A full meter holds one of four supers, never the one you fired last, and the next flick as you hit fires it: a **FIREBALL**, faster than any ordinary ball, wide of the other paddle; a **ZIGZAG**, which swerves at each third of the court; a **PHANTOM**, which vanishes halfway across; or **THUNDER**, which flies straight at the other paddle and breaks late. The computer fires its own, and between two people both do. Return one and it is **SAVED!**, and the rally goes on at its own pace; one point from winning with a super in hand, you are told to **FINISH IT!**. Each side fires two or three a match, and against the computer on Normal a super wins about half its points. Switch them off in Settings for the classic game; a Rush run never has them.
- **Fun extras,** behind one Fun switch: the computer signs in under a 90s arcade-club nickname; a won match ends with a **PONGALITY**, the loser's paddle shattered, launched, sliced, boiled away, flattened by a meteor, drawn into a black hole or frozen solid and shattered, while the result screen waits a moment (a tap or a key brings it at once). A match won with a super ends in that super's own **SUPER PONGALITY**: the paddle incinerated, shredded, broken up into pixels or electrocuted. Now and then a comic **TINYALITY** or **SNOOZALITY** plays instead, and a win to nil is **PERFECT!**. A lost match counts down **CONTINUE? 9… 0** like an arcade cabinet. The landlord taunts you for every point he takes, with a laugh, and beating him is an **EVICTALITY**: his paddle cracks and comes down in bricks.
- **A title screen, not a dashboard.** The Paddle Noir sign lights up in neon as the page opens, over four mode cards, the difficulty or the rival, and Play. Every switch waits behind **Settings**, each with a line on where it applies, and the score, the pause button and the thumb rail appear only once a match starts.
- **Portrait neon court** that fills a phone held upright and stands alone at full height on desktop, like an arcade cabinet.
- **Curve shots:** flick the paddle as it meets the ball and the ball bends in that direction. The computer cannot predict a curve.
- **Power-ups** appear mid-rally and go to whoever hit the ball last: **Wide** enlarges your paddle, **Shrink** shrinks the other side's, **Turbo** turns your shot into one blistering ball until it is returned, **Ghost** hides the ball in the other side's half, and **Multiball** splits a second ball off yours. A split-off ball bounces and scores like the ball, but its returns do not count toward the rally, and it fades after a few seconds. The computer keeps its eye on whichever ball reaches it first. They can be switched off in Settings.
- **A computer that plays like a person:** it reacts only once the ball comes within its reach, aims its returns away from you, and misjudges fast balls more.
- **Three difficulties** — Easy, Normal, Hard — tuned by simulating matches against human-like bots.
- **Drama:** a 3-2-1 countdown before the first serve, a **Match point** banner, slow motion as a match-point ball closes on a paddle, a split-second freeze on hard hits, and callouts for a **CURVE!**, a **SMASH!**, an **EDGE!** catch, a super by name and a **SAVED!** one.
- **Rallies that build:** every hit speeds the ball up, the rally counter pulses, long rallies heat the ball into a "fever" glow, and the music adds a layer at 3 hits and another at 6.
- **Juice:** sparks, shockwaves, screen shake, flashes, a speed-heated ball trail and victory fireworks, with synthesized sound effects, a synthesized backing track and vibration.
- **Five backing tracks**, all original and synthesized in the browser: **Neon** (synthwave), **Arena** (arcade fighter techno), **Anthem** (a big synth-brass anthem), **Contender** (training-montage rock) and **Iron** (heavy industrial). The music track in Settings, or the ♪ button on the pause screen, switches track and plays a few seconds of it.
- **Thumb rail:** on touch screens, a strip below the court steers the paddle, so your thumb never covers the play.
- **Solid paddles:** the ball meets a paddle's face, corners and sides as solid shapes. Clip a front corner and it comes back from the edge; catch it on the side and it glances off, but it never passes through. Once you have missed, a paddle moved into the ball stops against it instead of dragging it along.
- **Made for the phone:** a first-visit tutorial, full-screen mode, the screen stays awake during a match, and a Share button for a result. Every control is at least 44 by 44 pixels, the size a fingertip needs, even on a 320px-wide screen. Held sideways, the heads-up display becomes a column beside a full-height court, and the menus open as sheets across the screen.
- Mode, difficulty, power-ups, supers, sound, music and its track, vibration, your best rally, your best Rush run, your Solo win record and your career stars are remembered between visits, and stay in step across open tabs. Leaving a Solo match after its first point counts as a loss, so a streak is earned, not protected.

## What it demonstrates

- browser-agnostic **domain + application core**, kept deterministic (no clock, no randomness)
- explicit state machine: `ready → running ↔ paused → game-over`
- **domain events** (`paddle-hit`, `point`, `match-point`, `pickup`, `super-ready`, `game-over`, …) emitted by the simulation and turned into sound, music, vibration and visual effects by independent adapters
- **rules as data:** a match and a Rush run share one simulation; the rules object decides how a point counts
- a **deterministic random source** kept in the game state, so power-ups, supers and boss attacks vary between matches while the same seed replays a match exactly
- **content as data:** the career ladder is a list of rivals in `catalog.js`, each a tuning of the same game; bosses add attacks the domain runs like any other rule, and the final boss's phases are a list of them
- a fixed-step loop with a **time scale and hit-stop hold**, so slow motion and freeze frames never touch the simulation's step size
- fixed-timestep simulation with render interpolation, independent from display refresh rate
- a render loop that runs only during a match; idle screens cost no frames
- swept ball-against-paddle contact in the paddle's frame of reference: no tunnelling at any speed, solid corners and sides, and a property test that finds no overlap in over 100,000 simulated steps; plus contact-position bounce angles and spin that bends the path without changing speed
- typed ports: adapter contracts written as JSDoc and checked by the TypeScript compiler, with no build step
- adapters that receive browser globals by injection, so input, view, sound, vibration and storage are unit-tested in Node
- a Canvas renderer built for phones: pre-rendered glow sprites and background layers, additive blending, and a capped pixel ratio
- layer boundaries enforced by ESLint, with tests proving the rules still reject violations
- unit tests behind an honest coverage gate: every module is loaded, so an untested file counts at 0%, and each file must clear its own floor, not just the average
- **reference matches:** eight recorded bot matches replayed step by step and compared by digest, so new features provably leave classic play untouched
- accessible overlays: native modal tutorial and settings dialogs with managed focus, labelled pause and result dialogs, and decorative glyphs hidden from screen readers
- Playwright tests on desktop and mobile Chromium that assert on the rendered canvas
- an installable web app (manifest and icons) with safe-area-aware, reduced-motion-aware styling

## Stack

- semantic HTML5
- modern CSS (container queries, `:has()`, `dvh` units, safe-area insets)
- Vanilla JavaScript with native ES modules
- Canvas 2D and Web Audio
- Web App Manifest
- Node.js built-in test runner and coverage
- ESLint 10
- TypeScript 7, for JSDoc type-checking only
- Playwright Test 1.63
- GitHub Actions, for the checks and for deploying `main` to GitHub Pages

There is intentionally **no React, game engine, audio library, state library, dependency-injection framework, bundler, or runtime dependency**. Those tools would add surface area without solving a requirement in this product. TypeScript only checks the JavaScript that ships; nothing is compiled, and every sound is synthesized at play time.

## Architecture

The game separates browser input, rendering, audio, persistence, and the deterministic match state machine. [Engineering notes](docs/engineering.md#architecture) cover the component map and project structure.

## Run locally

The game itself has no runtime installation step. Because it uses native ES modules, serve the directory over HTTP:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`. To try it on a phone, open the same address from a device on your network.

For quality tooling:

```bash
npm ci
npm run check
npx playwright install chromium
npm run test:e2e
npm run docs:preview   # regenerate docs/preview.png after UI changes
npm run docs:icons     # regenerate the app icons from icons/icon.svg
```

## Controls

- **Touch:** drag on the court or on the thumb rail below it; a tap moves the paddle straight to that spot. In 2P, the bottom half of the court steers the bottom paddle and the top half the top one, and each finger keeps the paddle it started on.
- **Mouse:** move over the court; in 2P, press and drag
- **Keyboard:** `←` / `→` or `A` / `D` to move (by physical key, so any layout works, including Ukrainian and AZERTY), `Space` to start or pause, `Esc` to pause. Player 2 uses `J` / `L` or the numpad `4` / `6`.
- **Curve:** flick the paddle sideways as it meets the ball
- **Super:** with a full meter, the same flick as you hit fires it

Whichever device you used last steers the paddle, so the keyboard works even while the mouse rests on the board. Clicking a button hands focus back to the board, so `Space` keeps working. While the tutorial or the settings are open, `Space`, `Enter` and `Esc` belong to them: the game behind takes no keys or touches. The match pauses by itself when the window loses focus or the tab is hidden, and the page cannot scroll away while you play. Browser shortcuts such as `Ctrl+A` are never intercepted.

First to 7 wins in Solo, 2P and the career; in Rush, three misses end the run. The menu reads these rules from the match configuration.

## Verification strategy

The repository checks structure, lint, types, unit behavior and browser flows. [Engineering notes](docs/engineering.md#verification-strategy) document the coverage gates and scenarios.

## Recruiter walkthrough

If you have two minutes, inspect these files in order:

1. [`script.js`](./script.js) — composition root and dependency wiring
2. [`src/application/ports.js`](./src/application/ports.js) — the contracts adapters implement
3. [`src/domain/game.js`](./src/domain/game.js) — state transitions, scoring and game events
4. [`src/domain/opponent.js`](./src/domain/opponent.js) — a beatable, human-like computer opponent
5. [`src/domain/physics.js`](./src/domain/physics.js) — swept paddle contact in the paddle's frame of reference
6. [`src/adapters/canvas/event-effects.js`](./src/adapters/canvas/event-effects.js) — how events become visual effects
7. [`eslint.config.js`](./eslint.config.js) — executable architecture constraints
8. [`.github/workflows/quality.yml`](./.github/workflows/quality.yml) — automated verification, then the GitHub Pages deploy once `main` is green, checked against the live site file by file

## License

[MIT](./LICENSE)

## Author

Mykola Dotsenko
