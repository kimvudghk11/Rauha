import { ROLE_TOOLS, type MemberRole } from '@rauha/core/jobs';
import type { TeamMemberInfo, TeamOp, TeamResult, TeamView } from '../shared/ipc.js';
import { EFFORTS, NAME_LIMIT, TIERS, type Effort, type MemberSetting, type Tier } from '../shared/team-settings.js';
import { CHARACTER_ROLES, defaultSprite, type CharacterRole } from './characters.js';
import { el } from './dom.js';
import { paintOnce } from './stage.js';

export interface TeamApi {
  get(): Promise<TeamView>;
  apply(op: TeamOp): Promise<TeamResult>;
  /** 이름·캐릭터가 바뀌었을 때(화면의 캐릭터 덮어쓰기에 반영) */
  onChange(view: TeamView): void;
}

const TIER_LABEL: Readonly<Record<Tier, string>> = { haiku: 'Haiku (가볍고 빠름)', sonnet: 'Sonnet (균형)', opus: 'Opus (가장 깊게)' };
const EFFORT_LABEL: Readonly<Record<Effort, string>> = { low: '낮음', medium: '보통', high: '높음', xhigh: '아주 높음', max: '최대' };
const TOOL_LABEL: Readonly<Record<string, string>> = { Read: '읽기', Grep: '찾기', Glob: '파일 목록', WebSearch: '웹 검색', WebFetch: '웹 열기', Edit: '파일 고치기', Write: '파일 만들기', Bash: '명령 실행' };

const isCharacter = (r: string): r is CharacterRole => (CHARACTER_ROLES as readonly string[]).includes(r);

/**
 * 팀 설정(설정 탭 안): 팀원 22명 각각의 켜기·끄기, 모델 등급, 노력, 도구·쓰기, 추가 지시, 이름, 캐릭터, 기본값 복원.
 * 아무것도 안 바꾸면 기본 동작 그대로고, 바꾼 값은 다음 작업부터 엔진에 반영된다. 규칙은 TeamSettings·코어가 지키고 화면은 그리기만 한다.
 */
export function buildTeam(api: TeamApi) {
  const root = el('div', 'team');
  const note = el('div', 'hint pad', '바꾼 것은 다음 작업부터 반영돼요. 아무것도 안 바꾸면 지금까지와 똑같이 일해요.');
  const status = el('div', 'err pad');
  const list = el('div', 'tlist');
  const foot = el('div', 'tfoot');
  const resetAll = el('button', 'btn sec', '팀 전체 기본값으로');
  foot.appendChild(resetAll);
  root.append(note, status, list, foot);

  let view: TeamView | null = null;
  const open = new Set<MemberRole>();

  async function apply(op: TeamOp): Promise<void> {
    const res = await api.apply(op);
    if (!res.ok) {
      status.textContent = res.error;
      render();
      return;
    }
    status.textContent = '';
    view = res.view;
    api.onChange(view);
    render();
  }

  const change = (role: MemberRole, patch: Extract<TeamOp, { kind: 'change' }>['patch']): Promise<void> => apply({ kind: 'change', role, patch });

  function row(info: TeamMemberInfo, s: MemberSetting): HTMLElement {
    const enabled = s.enabled !== false;
    const changed = Object.keys(s).length > 0;
    const card = el('div', enabled ? 'tm' : 'tm off');
    const top = el('div', 'tmtop');
    const face = el('canvas', 'sp');
    paintOnce(face, (s.character ?? info.role) as CharacterRole, 2);
    const sprite = defaultSprite((s.character ?? info.role) as CharacterRole);
    const name = el('b', undefined, s.name ?? sprite.name);
    const title = el('span', 'ds', `${info.title}${info.stage !== null ? ` · ${info.stage}` : ''}`);
    top.append(face, name, title);
    if (changed) top.appendChild(el('span', 'chip', '바꿈'));

    const tier = el('select');
    for (const t of TIERS) tier.appendChild(new Option(`${TIER_LABEL[t]}${t === info.defaults.tier ? ' · 기본' : ''}`, t));
    tier.value = s.tier ?? info.defaults.tier;
    tier.addEventListener('change', () => void change(info.role, { tier: tier.value as Tier }));
    tier.disabled = !enabled;

    const toggle = el('label', 'tg');
    const box = el('input');
    box.type = 'checkbox';
    box.checked = enabled;
    box.disabled = info.required;
    box.title = info.required ? '작업 흐름에 꼭 필요한 팀원이라 끌 수 없어요.' : '';
    box.addEventListener('change', () => void change(info.role, { enabled: box.checked }));
    toggle.append(box, el('span', undefined, info.required ? '켬(고정)' : enabled ? '켬' : '끔'));

    const more = el('button', 'btn sec', open.has(info.role) ? '접기' : '자세히');
    more.addEventListener('click', () => {
      if (open.has(info.role)) open.delete(info.role);
      else open.add(info.role);
      render();
    });
    top.append(tier, toggle, more);
    card.appendChild(top);

    if (open.has(info.role)) {
      const body = el('div', 'tmbody');
      const field = (label: string, control: HTMLElement) => {
        const f = el('label', 'tf');
        f.append(el('span', 'lbl', label), control);
        return f;
      };

      const effort = el('select');
      for (const e of EFFORTS) effort.appendChild(new Option(`${EFFORT_LABEL[e]}${e === info.defaults.effort ? ' · 기본' : ''}`, e));
      effort.value = s.effort ?? info.defaults.effort;
      effort.addEventListener('change', () => void change(info.role, { effort: effort.value as Effort }));

      const tools = el('div', 'tools');
      const current = s.tools ?? info.defaults.tools;
      for (const t of ROLE_TOOLS) {
        const l = el('label', 'tool');
        const c = el('input');
        c.type = 'checkbox';
        c.checked = current.includes(t);
        c.addEventListener('change', () => void change(info.role, { tools: ROLE_TOOLS.filter((x) => (x === t ? c.checked : current.includes(x))) }));
        l.append(c, el('span', undefined, `${TOOL_LABEL[t] ?? t}${info.defaults.tools.includes(t) ? '' : ''}`));
        tools.appendChild(l);
      }
      const canWrite = current.includes('Edit') || current.includes('Write');
      const writeNote = el('div', 'hint', `${canWrite ? '파일을 쓸 수 있어요. 어느 파일까지 쓸 수 있는지는 작업 범위와 역할 권한(예: 문서 팀원은 문서만)이 늘 따로 지켜요.' : '파일을 쓰지 않아요.'} 비밀 파일은 어떤 설정이어도 막혀요.`);

      const extra = el('textarea');
      extra.rows = 3;
      extra.maxLength = 2000;
      extra.placeholder = '이 팀원에게만 더할 지시. 예: 설명은 존댓말로, 코드 예시를 꼭 넣어줘';
      extra.value = s.extraInstruction ?? '';
      extra.addEventListener('change', () => void change(info.role, { extraInstruction: extra.value.trim() === '' ? null : extra.value }));

      const nameInput = el('input');
      nameInput.maxLength = NAME_LIMIT;
      nameInput.placeholder = defaultSprite(info.role as CharacterRole).name;
      nameInput.value = s.name ?? '';
      nameInput.addEventListener('change', () => void change(info.role, { name: nameInput.value.trim() === '' ? null : nameInput.value }));

      const character = el('select');
      for (const c of CHARACTER_ROLES) character.appendChild(new Option(`${defaultSprite(c).name} (${defaultSprite(c).animal})${c === info.role ? ' · 기본' : ''}`, c));
      character.value = s.character ?? info.role;
      character.addEventListener('change', () => void change(info.role, { character: isCharacter(character.value) ? character.value : null }));

      const reset = el('button', 'btn sec', '이 팀원 기본값으로');
      reset.disabled = !changed;
      reset.addEventListener('click', () => void apply({ kind: 'reset', role: info.role }));

      body.append(field('노력 수준', effort), field('도구', tools), writeNote, field('추가 지시', extra), field('이름', nameInput), field('캐릭터', character), reset);
      card.appendChild(body);
    }
    return card;
  }

  function render(): void {
    list.replaceChildren();
    if (view === null) return;
    for (const info of view.members) list.appendChild(row(info, view.settings.members[info.role] ?? {}));
    resetAll.disabled = Object.keys(view.settings.members).length === 0;
  }

  resetAll.addEventListener('click', () => void apply({ kind: 'resetAll' }));
  void api.get().then((v) => {
    view = v;
    api.onChange(v);
    render();
  });
  return { root };
}
