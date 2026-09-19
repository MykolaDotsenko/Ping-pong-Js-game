# Architecture

## Goal

This project is intentionally small enough that its architecture can be understood in minutes.

The objective is not to imitate an enterprise backend in the browser. The objective is to make the important boundaries explicit so game rules can evolve independently from Canvas, DOM events, or frame timing.

## Dependency direction

```text
index.html
   |
script.js  ← composition root only
   |
   +--> adapters/input-controller.js
   +--> adapters/canvas-renderer.js
   +--> application/game-controller.js
                 |
                 +--> application/game-loop.js
                 +--> domain/game.js
                           |
                           +--> domain/physics.js
                           +--> domain/opponent.js
```

Dependencies point inward toward the domain. The domain does not import browser APIs.

## 1. Domain layer

`src/domain/` owns rules that define the game:

- explicit phases: `ready`, `running`, `paused`, `game-over`
- score transitions and win condition
- paddle boundaries
- ball movement and wall reflection
- paddle collision and bounce angle
- opponent movement strategy

The domain accepts plain data and returns new state. It does not draw, register listeners, query the DOM, or call `requestAnimationFrame`.

That is why the important behavior can be tested with Node's built-in test runner and no browser.

## 2. Application layer

`src/application/game-controller.js` coordinates use cases:

- start
- pause/resume
- reset
- update one simulation step
- synchronize status text with current state

`src/application/game-loop.js` isolates timing. It uses an accumulator and a fixed simulation step of 1/120 second.

### Why a fixed timestep?

Rendering refresh rates differ between devices. Updating physics by "one unit per frame" makes game speed depend on whether the browser renders at 60 Hz, 120 Hz, or temporarily stalls.

The loop therefore:

1. measures elapsed real time;
2. caps unusually large frame gaps;
3. advances the simulation in fixed increments;
4. renders after the simulation catches up.

Game rules become substantially easier to reason about and test.

## 3. Adapters

Browser-specific details stay at the edge.

### Input adapter

`InputController` translates:

- mouse/pointer/touch position
- Arrow Left / Arrow Right
- A / D

into a small input snapshot consumed by the domain.

The game rules do not know which physical device produced the command.

### Canvas adapter

`CanvasRenderer` converts domain state into pixels. It contains presentation choices only and never decides scoring, collisions, or winners.

A future DOM, SVG, WebGL, or test renderer could replace it without rewriting the rules.

## 4. Composition root

`script.js` deliberately contains almost no behavior. It creates concrete adapters, injects them into the controller, and connects the application.

This makes dependencies visible instead of hiding them in globals.

## State ownership

There is one authoritative game state owned by `GameController`.

No renderer or input adapter mutates game state. Domain functions return new state objects, which avoids hidden cross-module mutation and keeps transitions inspectable.

## Physics decisions

### Paddle bounce

The outgoing angle is derived from where the ball hits the paddle:

- center hit → mostly vertical return
- edge hit → larger horizontal component

Ball speed increases slightly after paddle contact and is capped to prevent unbounded difficulty.

### Collision crossing

Paddle collision compares the previous and current ball positions. This is safer than checking only whether the ball currently overlaps a paddle, especially as velocity increases.

## AI strategy

The opponent is intentionally understandable rather than unbeatable.

When the ball travels toward it, the strategy estimates a target using current position plus projected movement. When the ball travels away, it drifts toward center. Movement is speed-capped, so prediction quality and physical ability remain separate concerns.

## Deliberate omissions

The project does not add:

- React or another UI framework
- a dependency injection library
- Redux/global state tooling
- a physics engine
- a service/repository abstraction with no external resource
- a build pipeline

Those tools would increase surface area without solving a requirement in this game.

## Testing strategy

The highest-value rules are tested directly:

- state-machine transitions
- paddle clamping
- scoring
- game-over transition
- wall reflection
- paddle bounce direction and speed

The test suite uses `node:test`, so there are no test-framework dependencies to maintain.

## Extension points

The current boundaries make several changes local:

- replace opponent strategy → `domain/opponent.js`
- tune difficulty → `config.js`
- replace Canvas → new renderer adapter
- add a second human player → new input mapping + domain command
- add sound → event-aware presentation adapter
- add replay/debug snapshots → observe controller state without modifying physics

The architecture exists to make changes like these predictable, not to maximize the number of files.
