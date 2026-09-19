import { GAME_PHASE } from '../domain/game.js';

export class CanvasRenderer {
  constructor(canvas, config) {
    this.canvas = canvas;
    this.config = config;
    this.context = canvas.getContext('2d');
    this.canvas.width = config.width;
    this.canvas.height = config.height;
  }

  render(state) {
    const ctx = this.context;
    const { width, height, paddle, ball } = this.config;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#09111f';
    ctx.fillRect(0, 0, width, height);

    this.drawCenterLine();
    this.drawScore(state);
    this.drawPaddle(state.opponent.x, paddle.inset);
    this.drawPaddle(state.player.x, height - paddle.inset - paddle.height);
    this.drawBall(state.ball.x, state.ball.y, ball.radius);

    if (state.phase === GAME_PHASE.READY) {
      this.drawOverlay('Ready', 'Press Start or Space');
    } else if (state.phase === GAME_PHASE.PAUSED) {
      this.drawOverlay('Paused', 'Press Pause or Space to continue');
    } else if (state.phase === GAME_PHASE.GAME_OVER) {
      const winner = state.score.player > state.score.opponent ? 'You win' : 'Computer wins';
      this.drawOverlay(winner, 'Press Start for a new match');
    }
  }

  drawCenterLine() {
    const ctx = this.context;
    ctx.save();
    ctx.strokeStyle = 'rgba(203, 213, 225, 0.28)';
    ctx.setLineDash([12, 14]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, this.config.height / 2);
    ctx.lineTo(this.config.width, this.config.height / 2);
    ctx.stroke();
    ctx.restore();
  }

  drawScore(state) {
    const ctx = this.context;
    ctx.save();
    ctx.fillStyle = 'rgba(241, 245, 249, 0.92)';
    ctx.font = '700 36px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(String(state.score.opponent), 28, this.config.height / 2 - 30);
    ctx.fillText(String(state.score.player), 28, this.config.height / 2 + 58);
    ctx.restore();
  }

  drawPaddle(centerX, y) {
    const { paddle } = this.config;
    const x = centerX - paddle.width / 2;
    const ctx = this.context;

    ctx.save();
    ctx.fillStyle = '#f8fafc';
    ctx.shadowColor = 'rgba(94, 234, 212, 0.32)';
    ctx.shadowBlur = 16;
    ctx.fillRect(x, y, paddle.width, paddle.height);
    ctx.restore();
  }

  drawBall(x, y, radius) {
    const ctx = this.context;
    ctx.save();
    ctx.fillStyle = '#5eead4';
    ctx.shadowColor = 'rgba(94, 234, 212, 0.65)';
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawOverlay(title, subtitle) {
    const ctx = this.context;
    ctx.save();
    ctx.fillStyle = 'rgba(4, 10, 20, 0.66)';
    ctx.fillRect(0, 0, this.config.width, this.config.height);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#f8fafc';
    ctx.font = '700 42px system-ui, sans-serif';
    ctx.fillText(title, this.config.width / 2, this.config.height / 2 - 10);
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '500 18px system-ui, sans-serif';
    ctx.fillText(subtitle, this.config.width / 2, this.config.height / 2 + 30);
    ctx.restore();
  }
}
