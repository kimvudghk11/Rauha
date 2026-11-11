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

const TONE_TEXT = { green: 'plenty left', yellow: 'getting high', red: 'almost full' } as const;
const pct = (w: { percent: number } | null): string => (w === null ? 'not read yet' : `${Math.round(w.percent)}% (${TONE_TEXT[limitTone(w.percent)]})`);

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
        deps.say(b === null ? 'Could not read the job board yet.' : `Running ${b.running} · Waiting for approval ${b.waiting} · Queued ${b.queued} (up to ${b.limit} at once)`);
        return;
      }
      case 'queue': {
        const waiting = deps.jobs().filter((j) => j.status === 'queued');
        deps.say(waiting.length === 0 ? 'No queued jobs.' : ['Queued jobs', ...waiting.map((j, i) => `${i + 1}. ${j.request}`)].join('\n'));
        return;
      }
      case 'usage': {
        const u = await deps.api.getUsage();
        deps.say(u === null ? 'Could not read usage yet.' : `Session (5 hours) ${pct(u.session)}\nThis week ${pct(u.weekly)}`);
        return;
      }
      case 'guide': {
        const last = lastDone();
        if (last === null) deps.say('No finished jobs yet.');
        else deps.openJob(last.id);
        return;
      }
      case 'copy': {
        const last = lastDone();
        if (last === null) return deps.say('No answer to copy yet.');
        try {
          await navigator.clipboard.writeText(last.result ?? '');
          deps.say('Copied the last answer to the clipboard.');
        } catch {
          deps.say('Could not copy to the clipboard.');
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
          deps.say(`/${r.name} is not a command. Type / to see the list. To send it as plain text, add another / in front.`);
          return null;
        case 'off':
          deps.say(`/${r.command.name} is turned off. Turn it on in the Slash tab.`);
          return null;
        case 'usage':
          deps.say(`Missing: ${r.missing.join(', ')}. Usage: ${r.command.usage()}`);
          return null;
        case 'app': {
          if (r.action === 'retry') {
            const last = [...deps.jobs()].reverse()[0];
            if (last === undefined) {
              deps.say('No request to resend yet.');
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
  box.appendChild(el('div', 'ttl', 'Available commands'));
  for (const c of book.active()) {
    const row = el('div', 'r');
    row.append(el('b', undefined, c.usage()), el('span', undefined, c.description));
    box.appendChild(row);
  }
  box.appendChild(el('div', 'dim', 'Add your own commands in the Slash tab.'));
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
    const copy = el('button', 'btn primary', 'Copy command');
    copy.addEventListener('click', () => {
      void navigator.clipboard.writeText(command).then(
        () => (copy.textContent = 'Copied'),
        () => (copy.textContent = 'Could not copy'),
      );
    });
    box.appendChild(copy);
  }
  if (g.download) {
    const get = el('button', 'btn primary', 'Download the latest installer');
    get.addEventListener('click', () => void api.update.download().then((ok) => (get.textContent = ok ? 'Opened in your browser' : 'No file to download yet')));
    box.appendChild(get);
  }
  return box;
}
