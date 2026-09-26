import { GAME_PHASE } from '../../domain/game.js';
import { FEVER_RALLY } from './theme.js';

/** @import { GameState } from '../../domain/types.js' */

const TRAIL_LENGTH = 18;
const FEVER_TRAIL_LENGTH = TRAIL_LENGTH + 8;
// A jump this long between frames is a new serve or a restart, not motion.
const TELEPORT_DISTANCE = 120;

/**
 * The recent positions of the ball, drawn as a fading tail. It restarts with every serve,
 * and grows longer in a fever rally or under Turbo.
 */
export class BallTrail {
  constructor() {
    /** @type {Array<{ x: number, y: number }>} */
    this.points = [];
    this.serve = -1;
  }

  clear() {
    this.points = [];
  }

  /** @param {GameState} state */
  update(state) {
    const { ball } = state;
    const last = this.points[this.points.length - 1];
    const teleported = last !== undefined && Math.hypot(ball.x - last.x, ball.y - last.y) > TELEPORT_DISTANCE;

    if (state.serveNumber !== this.serve || state.serveCountdown > 0 || teleported) {
      this.points = [];
      this.serve = state.serveNumber;
    }

    if (state.phase !== GAME_PHASE.RUNNING || state.serveCountdown > 0) {
      return;
    }

    this.points.push({ x: ball.x, y: ball.y });
    const length = state.rally >= FEVER_RALLY || state.turbo > 0 ? FEVER_TRAIL_LENGTH : TRAIL_LENGTH;

    if (this.points.length > length) {
      this.points.splice(0, this.points.length - length);
    }
  }
}
