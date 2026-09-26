/**
 * @typedef {object} Particle
 * @property {number} x
 * @property {number} y
 * @property {number} vx
 * @property {number} vy
 * @property {number} life seconds left
 * @property {number} maxLife
 * @property {number} size
 * @property {string} color
 * @property {number} drag
 * @property {number} gravity
 *
 * @typedef {object} Ring
 * @property {number} x
 * @property {number} y
 * @property {number} radius
 * @property {number} growth units per second
 * @property {number} life seconds left
 * @property {number} maxLife
 * @property {string} color
 * @property {number} width
 *
 * @typedef {object} BurstOptions
 * @property {number} x
 * @property {number} y
 * @property {string} color
 * @property {number} count
 * @property {number} speed typical launch speed, varied by ±50%
 * @property {number} [direction] center of the spray, in radians
 * @property {number} [spread] full width of the spray, in radians; a full circle by default
 * @property {number} [life] typical lifetime in seconds
 * @property {number} [size]
 * @property {number} [gravity]
 * @property {number} [drag]
 *
 * @typedef {'player' | 'opponent'} Side
 *
 * @typedef {Pick<CanvasRenderingContext2D,
 *   'save' | 'restore' | 'beginPath' | 'moveTo' | 'lineTo' | 'arc' | 'stroke'
 * > & { globalCompositeOperation: string, globalAlpha: number, strokeStyle: unknown, lineWidth: number, lineCap: string }} EffectsContext
 */

// Exponential decay rates, per second.
const DECAY = Object.freeze({ flash: 9, shake: 8, squash: 12, pulse: 5, pop: 5 });
const SETTLED = 0.01;

/**
 * Short-lived visual feedback: sparks, shockwave rings, screen shake, flashes and paddle
 * squash. It is presentation state only; the game never reads it. Randomness is injectable
 * so tests and screenshots can make the effects repeatable.
 */
export class Effects {
  /**
   * @param {object} [options]
   * @param {() => number} [options.random]
   * @param {boolean} [options.reducedMotion] no shake, softer flashes, fewer particles
   * @param {number} [options.maxParticles]
   */
  constructor({ random = Math.random, reducedMotion = false, maxParticles = 280 } = {}) {
    this.random = random;
    this.reducedMotion = reducedMotion;
    this.maxParticles = maxParticles;
    /** @type {Particle[]} */
    this.particles = [];
    /** @type {Ring[]} */
    this.rings = [];
    /** @type {Array<{ delay: number, action: () => void }>} */
    this.scheduled = [];
    this.flashColor = '#ffffff';
    this.flashAlpha = 0;
    this.shakeAmount = 0;
    this.pulseAmount = 0;
    this.popAmount = 0;
    /** @type {Record<Side, number>} */
    this.squash = { player: 0, opponent: 0 };
  }

  get active() {
    return this.particles.length > 0
      || this.rings.length > 0
      || this.scheduled.length > 0
      || this.flashAlpha > SETTLED
      || this.shakeAmount > SETTLED
      || this.pulseAmount > SETTLED
      || this.popAmount > SETTLED
      || this.squash.player > SETTLED
      || this.squash.opponent > SETTLED;
  }

  /** @param {BurstOptions} options */
  burst({ x, y, color, count, speed, direction = 0, spread = Math.PI * 2, life = 0.55, size = 2.2, gravity = 0, drag = 2.4 }) {
    const total = this.reducedMotion ? Math.ceil(count * 0.4) : count;

    for (let i = 0; i < total && this.particles.length < this.maxParticles; i += 1) {
      const angle = direction + (this.random() - 0.5) * spread;
      const launch = speed * (0.5 + this.random());
      const maxLife = life * (0.6 + this.random() * 0.8);

      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * launch,
        vy: Math.sin(angle) * launch,
        life: maxLife,
        maxLife,
        size: size * (0.6 + this.random() * 0.8),
        color,
        drag,
        gravity,
      });
    }
  }

  /**
   * @param {object} options
   * @param {number} options.x
   * @param {number} options.y
   * @param {string} options.color
   * @param {number} [options.radius]
   * @param {number} [options.growth]
   * @param {number} [options.life]
   * @param {number} [options.width]
   */
  ring({ x, y, color, radius = 6, growth = 240, life = 0.45, width = 3 }) {
    this.rings.push({ x, y, radius, growth, life, maxLife: life, color, width });
  }

  /**
   * @param {string} color
   * @param {number} strength peak opacity
   */
  flash(color, strength) {
    this.flashColor = color;
    this.flashAlpha = Math.max(this.flashAlpha, this.reducedMotion ? strength * 0.3 : strength);
  }

  /** @param {number} amount 0 for none, 1 for a heavy hit */
  shake(amount) {
    if (!this.reducedMotion) {
      this.shakeAmount = Math.min(1.2, this.shakeAmount + amount);
    }
  }

  /** @param {Side} side */
  kick(side) {
    this.squash[side] = 1;
  }

  /** @param {number} amount */
  pulse(amount) {
    this.pulseAmount = Math.min(1, Math.max(this.pulseAmount, amount));
  }

  pop() {
    this.popAmount = 1;
  }

  /**
   * @param {number} delay seconds
   * @param {() => void} action
   */
  schedule(delay, action) {
    this.scheduled.push({ delay, action });
  }

  clear() {
    this.particles = [];
    this.rings = [];
    this.scheduled = [];
    this.flashAlpha = 0;
    this.shakeAmount = 0;
    this.pulseAmount = 0;
    this.popAmount = 0;
    this.squash = { player: 0, opponent: 0 };
  }

  /** @param {number} deltaSeconds */
  update(deltaSeconds) {
    if (deltaSeconds <= 0) {
      return;
    }

    const due = this.scheduled.filter((entry) => (entry.delay -= deltaSeconds) <= 0);
    this.scheduled = this.scheduled.filter((entry) => entry.delay > 0);
    due.forEach((entry) => entry.action());

    for (const particle of this.particles) {
      const slow = Math.exp(-particle.drag * deltaSeconds);
      particle.vx *= slow;
      particle.vy = particle.vy * slow + particle.gravity * deltaSeconds;
      particle.x += particle.vx * deltaSeconds;
      particle.y += particle.vy * deltaSeconds;
      particle.life -= deltaSeconds;
    }

    for (const ring of this.rings) {
      ring.radius += ring.growth * deltaSeconds;
      ring.life -= deltaSeconds;
    }

    this.particles = this.particles.filter((particle) => particle.life > 0);
    this.rings = this.rings.filter((ring) => ring.life > 0);
    this.flashAlpha = settle(this.flashAlpha * Math.exp(-DECAY.flash * deltaSeconds));
    this.shakeAmount = settle(this.shakeAmount * Math.exp(-DECAY.shake * deltaSeconds));
    this.pulseAmount = settle(this.pulseAmount * Math.exp(-DECAY.pulse * deltaSeconds));
    this.popAmount = settle(this.popAmount * Math.exp(-DECAY.pop * deltaSeconds));
    this.squash.player = settle(this.squash.player * Math.exp(-DECAY.squash * deltaSeconds));
    this.squash.opponent = settle(this.squash.opponent * Math.exp(-DECAY.squash * deltaSeconds));
  }

  /**
   * @param {number} maxShift board units at full shake
   * @returns {{ x: number, y: number }}
   */
  shakeOffset(maxShift) {
    if (this.shakeAmount === 0) {
      return { x: 0, y: 0 };
    }

    const shift = maxShift * this.shakeAmount ** 2;
    return { x: (this.random() * 2 - 1) * shift, y: (this.random() * 2 - 1) * shift };
  }

  /**
   * Draws sparks as short streaks along their motion, and rings, with additive blending so
   * overlapping light adds up like neon.
   *
   * @param {EffectsContext} context
   */
  draw(context) {
    if (this.particles.length === 0 && this.rings.length === 0) {
      return;
    }

    context.save();
    context.globalCompositeOperation = 'lighter';
    context.lineCap = 'round';

    for (const particle of this.particles) {
      const fade = particle.life / particle.maxLife;
      context.globalAlpha = fade;
      context.strokeStyle = particle.color;
      context.lineWidth = particle.size * (0.5 + fade * 0.5);
      context.beginPath();
      context.moveTo(particle.x, particle.y);
      context.lineTo(particle.x - particle.vx * 0.028, particle.y - particle.vy * 0.028);
      context.stroke();
    }

    for (const ring of this.rings) {
      const fade = ring.life / ring.maxLife;
      context.globalAlpha = fade * 0.9;
      context.strokeStyle = ring.color;
      context.lineWidth = ring.width * fade + 0.5;
      context.beginPath();
      context.arc(ring.x, ring.y, ring.radius, 0, Math.PI * 2);
      context.stroke();
    }

    context.restore();
  }
}

/** @param {number} value */
function settle(value) {
  return value < SETTLED ? 0 : value;
}
