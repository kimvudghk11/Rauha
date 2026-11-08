import { type CommandBook } from '../shared/command-book.js';
import { installGuide } from '../shared/install-guide.js';
import type { BoardView, JobView, RauhaApi } from '../shared/ipc.js';
import type { UpdateView } from '../shared/update-record.js';
import { limitTone } from '../shared/settings.js';
import { el } from './dom.js';
import { diagnosticsText } from './diagnostics-text.js';

/** 명령을 실행하는 데 필요한 바깥 세계. app.ts가 채운다. */
export interface RunnerDeps {
  readonly book: () => CommandBook;
  /** 채팅에 안내 말풍선을 더한다 */
  readonly say: (content: string | HTMLElement) => void;
  readonly clear: () => void;
  readonly openTab: (tab: string) => void;
  readonly openJob: (id: string) => void;
  readonly jobs: () => readonly JobView[];
  readonly board: () => BoardView | null;
  readonly api: Pick<RauhaApi, 'getUsage' | 'update' | 'platform' | 'copyDiagnostics'>;
}

const TONE_TEXT = { green: '여유', yellow: '조금 높아요', red: '거의 찼어요' } as const;
const pct = (w: { percent: number } | null): string => (w === null ? '아직 못 읽었어요' : `${Math.round(w.percent)}% (${TONE_TEXT[limitTone(w.percent)]})`);

/**
 * 입력 한 줄을 읽어 명령이면 처리하고, 요청으로 보낼 글을 돌려준다(명령을 앱이 처리했으면 null).
 * 규칙(이름·인자 해석)은 CommandBook이 하고, 여기서는 결과를 화면 동작으로 옮기기만 한다.
 */
export function createRunner(deps: RunnerDeps) {
  const lastDone = (): JobView | null => [...deps.jobs()].reverse().find((j) => j.status === 'done' && j.result !== null) ?? null;

  async function runApp(action: string, tab: string | null): Promise<void> {
    switch (action) {
      case 'tab':
        if (tab !== null) deps.openTab(tab);
        return;
      case 'clear':
        deps.clear();
        return;
      case 'help':
        deps.say(helpBox(deps.book()));
        return;
      case 'close':
        window.close();
        return;
      case 'status': {
        const b = deps.board();
        deps.say(b === null ? '작업판을 아직 못 읽었어요.' : `돌고 있는 작업 ${b.running}개 · 허락 기다림 ${b.waiting}개 · 대기 ${b.queued}개 (동시에 ${b.limit}개까지)`);
        return;
      }
      case 'queue': {
        const waiting = deps.jobs().filter((j) => j.status === 'queued');
        deps.say(waiting.length === 0 ? '기다리는 작업이 없어요.' : ['기다리는 작업', ...waiting.map((j, i) => `${i + 1}. ${j.request}`)].join('\n'));
        return;
      }
      case 'usage': {
        const u = await deps.api.getUsage();
        deps.say(u === null ? '사용률을 아직 못 읽었어요.' : `세션(5시간) ${pct(u.session)}\n이번 주 ${pct(u.weekly)}`);
        return;
      }
      case 'guide': {
        const last = lastDone();
        if (last === null) deps.say('아직 끝난 작업이 없어요.');
        else deps.openJob(last.id);
        return;
      }
      case 'copy': {
        const last = lastDone();
        if (last === null) return deps.say('복사할 답이 아직 없어요.');
        try {
          await navigator.clipboard.writeText(last.result ?? '');
          deps.say('마지막 답을 클립보드에 복사했어요.');
        } catch {
          deps.say('클립보드에 복사하지 못했어요.');
        }
        return;
      }
      case 'diagnose':
        deps.say(diagnosticsText(await deps.api.copyDiagnostics().catch(() => null)));
        return;
      case 'install':
      case 'update': {
        const view = action === 'update' ? await deps.api.update.check().catch(() => null) : await deps.api.update.state().catch(() => null);
        deps.say(installBox(deps.api, view));
        return;
      }
    }
  }

  return {
    /** 보낼 글(그대로 또는 템플릿으로 만든 것)을 돌려준다. 앱이 처리했으면 null. */
    async intercept(text: string): Promise<string | null> {
      const r = deps.book().resolve(text);
      switch (r.kind) {
        case 'text':
        case 'send':
          return r.text;
        case 'list':
          deps.say(helpBox(deps.book()));
          return null;
        case 'unknown':
          deps.say(`/${r.name}은(는) 없는 명령이에요. /를 쳐서 목록을 볼 수 있어요. 그대로 보내려면 앞에 /를 하나 더 붙여요.`);
          return null;
        case 'off':
          deps.say(`/${r.command.name}은(는) 꺼 둔 명령이에요. 명령어 탭에서 켤 수 있어요.`);
          return null;
        case 'usage':
          deps.say(`${r.missing.join('·')} 칸이 비었어요. 사용법: ${r.command.usage()}`);
          return null;
        case 'app': {
          if (r.action === 'retry') {
            const last = [...deps.jobs()].reverse()[0];
            if (last === undefined) {
              deps.say('다시 보낼 요청이 아직 없어요.');
              return null;
            }
            return last.request;
          }
          await runApp(r.action, r.tab);
          return null;
        }
      }
    },
  };
}

function helpBox(book: CommandBook): HTMLElement {
  const box = el('div', 'cmd-help');
  box.appendChild(el('div', 'ttl', '쓸 수 있는 명령'));
  for (const c of book.active()) {
    const row = el('div', 'r');
    row.append(el('b', undefined, c.usage()), el('span', undefined, c.description));
    box.appendChild(row);
  }
  box.appendChild(el('div', 'dim', '내 명령은 명령어 탭에서 더해요.'));
  return box;
}

function installBox(api: Pick<RauhaApi, 'update' | 'platform'>, view: UpdateView | null): HTMLElement {
  const g = installGuide(api.platform, view === null ? null : { newer: view.newer, latest: view.latest, hasDownload: view.hasDownload });
  const box = el('div', 'cmd-help');
  box.appendChild(el('div', 'ttl', g.title));
  for (const line of g.lines) box.appendChild(el('div', undefined, line));
  if (g.copy !== null) {
    const command = g.copy;
    box.appendChild(el('code', 'cmd-line', command));
    const copy = el('button', 'btn primary', '명령 복사');
    copy.addEventListener('click', () => {
      void navigator.clipboard.writeText(command).then(
        () => (copy.textContent = '복사했어요'),
        () => (copy.textContent = '복사하지 못했어요'),
      );
    });
    box.appendChild(copy);
  }
  if (g.download) {
    const get = el('button', 'btn primary', '최신 설치 파일 내려받기');
    get.addEventListener('click', () => void api.update.download().then((ok) => (get.textContent = ok ? '브라우저에서 열었어요' : '내려받을 파일이 아직 없어요')));
    box.appendChild(get);
  }
  return box;
}
