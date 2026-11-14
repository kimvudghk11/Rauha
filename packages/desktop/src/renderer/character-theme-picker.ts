import type { CharacterSetId } from '../shared/character-set-ids.js';
import { CHARACTER_SETS, characterSetById } from './character-sets/index.js';
import { FRAME, setSprite, type CharacterRole } from './characters.js';
import { el } from './dom.js';
import { paintSpriteFrame } from './pixel-art.js';
import { select } from './todo-parts.js';

/** 미리보기 무대에 세울 대표 5명(팀장 먼저) */
export const STAGE_ROLES: readonly CharacterRole[] = ['intake', 'tester', 'implementer', 'reviewer', 'bm'];

/** 칸마다 다른 박자로 도는 표정 순서(대부분 기본, 가끔 깜빡·기쁨·걱정·졸음) */
const SCRIPT: readonly number[] = [FRAME.idle, FRAME.idle, FRAME.idle, FRAME.blink, FRAME.idle, FRAME.idle, FRAME.happy, FRAME.happy, FRAME.idle, FRAME.idle, FRAME.blink, FRAME.idle, FRAME.worry, FRAME.idle, FRAME.idle, FRAME.sleep, FRAME.sleep, FRAME.idle];

/** 지금 박자에서 칸 i 의 표정 프레임(순수: 시험에서 확인한다) */
export function stageFrame(tick: number, slot: number): number {
  return SCRIPT[(tick + slot * 5) % SCRIPT.length] as number;
}

/** 지금 박자에서 칸 i 가 위로 뜬 높이(px, 0~3: 통통 튀는 움직임) */
export function stageBob(tick: number, slot: number): number {
  const phase = (tick + slot * 2) % 6;
  return [0, 1, 3, 3, 1, 0][phase] as number;
}

/**
 * 캐릭터 컨셉 고르기: 브랜치 고르듯 드롭다운으로 컨셉을 바꾸고, 아래 무대 5칸에서 대표 캐릭터가 움직인다.
 * 화면에서 떨어지면(설정을 닫으면) 움직임 타이머를 스스로 멈춘다.
 */
export function buildThemePicker(current: CharacterSetId, choose: (id: CharacterSetId) => void): HTMLElement {
  const root = el('div', 'theme-picker');
  let shown = characterSetById(current);
  const bar = el('div', 'bar');
  const sel = select(CHARACTER_SETS.map((s) => [s.id, s.name] as const), shown.id, (id) => {
    shown = characterSetById(id);
    blurb.textContent = shown.blurb;
    paintStage();
    choose(shown.id);
  });
  sel.setAttribute('aria-label', 'Character concept');
  sel.classList.add('theme-select');
  const blurb = el('span', 'hint grow', shown.blurb);
  bar.append(el('span', 'lbl', 'Concept'), sel, blurb);

  const stage = el('div', 'theme-stage');
  stage.setAttribute('aria-hidden', 'true');
  const slots = STAGE_ROLES.map(() => {
    const slot = el('div', 'theme-slot');
    const canvas = el('canvas', 'sp');
    const label = el('span', 'theme-name');
    slot.append(canvas, label);
    stage.append(slot);
    return { slot, canvas, label };
  });

  let tick = 0;
  const paintStage = (): void => {
    slots.forEach((s, i) => {
      const sprite = setSprite(shown, STAGE_ROLES[i] as CharacterRole);
      paintSpriteFrame(s.canvas, sprite, stageFrame(tick, i), 5);
      s.canvas.style.transform = `translateY(${-stageBob(tick, i)}px)`;
      s.label.textContent = sprite.name;
      s.slot.title = `${sprite.name} (${sprite.animal})`;
    });
  };
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const timer = reduce
    ? undefined
    : setInterval(() => {
        if (!root.isConnected) {
          if (tick > 0) clearInterval(timer);
          return;
        }
        tick += 1;
        paintStage();
      }, 220);
  paintStage();
  root.append(bar, stage);
  return root;
}
