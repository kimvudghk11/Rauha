import { motionFor } from './character-motion.js';
import { FRAME, spriteFor, type CharacterArt, type CharacterRole, type CharacterState, type DrawOptions } from './characters.js';

const GLYPH: Readonly<Record<string, readonly string[]>> = {
  q: ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'],
  ex: ['.#.', '.#.', '.#.', '.#.', '...', '.#.'],
  bulb: ['.###.', '#ooo#', '#ooo#', '.#o#.', '..#..', '.###.'],
  sp: ['.#.', '###', '.#.'],
  dot: ['#'],
  drop: ['.#.', '###', '###', '.#.'],
  z: ['###', '.#.', '#..', '###'],
};
const YELLOW = '#FFDB7A';

function glyph(ctx: CanvasRenderingContext2D, k: number, name: string, x: number, y: number, c1: string, c2: string): void {
  const g = GLYPH[name]!;
  g.forEach((row, r) =>
    [...row].forEach((ch, c) => {
      if (ch === '.') return;
      ctx.fillStyle = ch === 'o' ? c2 : c1;
      ctx.fillRect((x + c) * k, (y + r) * k, k, k);
    }),
  );
}

/** 픽셀 격자로 그리는 공급자. 상태별 덧그림(말풍선 타자·물음표·느낌표·반짝이·땀방울·z)까지 한 곳에서 그린다. */
export const pixelArt: CharacterArt = {
  size(role) {
    const f = spriteFor(role).frames[0]!;
    return { w: f[0]!.length, h: f.length };
  },

  draw(ctx, role: CharacterRole, state: CharacterState, tick: number, o: DrawOptions): void {
    const sprite = spriteFor(role);
    const { w, h } = this.size(role);
    const k = o.scale;
    const t = tick + (o.seed ?? 0) * 3;
    const m = motionFor(state, tick, o.seed ?? 0);
    const flip = m.flip ?? o.flip ?? false;
    const rows = sprite.frames[m.frame] ?? sprite.frames[FRAME.idle]!;

    // 바닥 그림자
    ctx.fillStyle = 'rgba(0,0,0,.3)';
    const sh = m.dy < -1 ? 4 : 2;
    ctx.fillRect((o.x + Math.floor(sh / 2)) * k, (o.y + h) * k, (w - sh) * k, k);

    rows.forEach((row, r) => {
      for (let c = 0; c < w; c += 1) {
        const ch = row[flip ? w - 1 - c : c]!;
        if (ch === '.') continue;
        ctx.fillStyle = sprite.palette[ch] ?? '#f0f';
        ctx.fillRect((o.x + m.dx + c) * k, (o.y + m.dy + r) * k, k, k);
      }
    });
    if (o.effects === false) return;

    const { x: x0, y: y0 } = o;
    const cx = x0 + m.dx;
    if (state === 'work') {
      const bx = x0 + ((w - 11) >> 1);
      const by = y0 - 7;
      const n = 1 + ((t >> 2) % 3);
      ctx.fillStyle = '#EAF2FB';
      ctx.fillRect((bx + 1) * k, by * k, 9 * k, k);
      ctx.fillRect(bx * k, (by + 1) * k, 11 * k, 3 * k);
      ctx.fillRect((bx + 1) * k, (by + 4) * k, 9 * k, k);
      ctx.fillRect((bx + 3) * k, (by + 5) * k, k, k);
      for (let i = 0; i < 3; i += 1) {
        ctx.fillStyle = i < n ? '#1D2B3A' : '#B9C8DA';
        ctx.fillRect((bx + 2 + i * 3) * k, (by + 2) * k, k, k);
      }
    } else if (state === 'think') {
      const ph = t % 28;
      const gx = x0 + w - 3;
      const gy = y0 - 8;
      if (ph < 18) glyph(ctx, k, 'q', gx, gy + ((ph >> 2) & 1), YELLOW, YELLOW);
      else {
        const lit = (ph >> 1) & 1;
        glyph(ctx, k, 'bulb', gx, gy, YELLOW, lit ? '#FFF3B8' : '#7a6a30');
        if (lit) {
          ctx.fillStyle = YELLOW;
          ctx.fillRect((gx - 2) * k, (gy + 2) * k, k, k);
          ctx.fillRect((gx + 6) * k, (gy + 2) * k, k, k);
        }
      }
    } else if (state === 'wait') {
      const hy = y0 + 4 - ((t >> 1) & 1 ? 2 : 0);
      ctx.fillStyle = sprite.palette['B'] ?? '#fff';
      ctx.fillRect((x0 + w) * k, hy * k, 2 * k, 2 * k);
      ctx.fillStyle = '#fff';
      ctx.fillRect((x0 + w) * k, hy * k, k, k);
      if ((t >> 1) % 4 < 3) glyph(ctx, k, 'ex', x0 + ((w - 3) >> 1), y0 - 7, '#FF9E64', '#FF9E64');
    } else if (state === 'done') {
      ([[-3, 1], [w + 1, 3], [w - 3, -4]] as const).forEach((p, i) => {
        if ((t + i * 3) % 8 < 4) glyph(ctx, k, 'sp', x0 + p[0], y0 + p[1], YELLOW, YELLOW);
        else glyph(ctx, k, 'dot', x0 + p[0] + 1, y0 + p[1] + 1, '#FFF3B8', '#FFF3B8');
      });
    } else if (state === 'stuck') {
      glyph(ctx, k, 'drop', cx + w - 2, y0 + 1 + ((t >> 1) % 5), '#9FD8FF', '#9FD8FF');
    } else if (state === 'rest') {
      for (let i = 0; i < 3; i += 1) {
        const ph = ((t >> 1) + i * 4) % 12;
        if (ph < 10) glyph(ctx, k, 'z', x0 + w - 2 + (ph >> 2), y0 + 1 - Math.floor(ph * 0.7), '#C4E8FF', '#C4E8FF');
      }
    }
  },
};
