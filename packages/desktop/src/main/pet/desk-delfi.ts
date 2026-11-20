import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { BrowserWindow, Menu, screen, type IpcMain, type IpcMainEvent, type WebContents } from 'electron';
import { DeskPet } from '../../shared/desk-pet.js';
import { PET_IPC, toDelfiVoice, type DelfiVoice, type MicState, type PetView } from '../../shared/desk-pet-ipc.js';
import { Ear } from '../../shared/voice/ear.js';
import { mfcc } from '../../shared/voice/mfcc.js';
import { SpokenText } from '../../shared/voice/spoken.js';
import { WAKE_SAMPLES_NEEDED, WakeTemplates, WakeTemplatesDto } from '../../shared/voice/wake-match.js';
import { LocalSpeaker } from '../voice/local-speaker.js';
import { LocalTranscriber } from '../voice/local-transcriber.js';

/** 창 크기: 아래쪽에 캐릭터, 위쪽에 말풍선 */
const SIZE = { width: 240, height: 200 } as const;
const TICK_MS = 50;
/** 받을 수 있는 가장 긴 말(16kHz 로 20초) */
const MAX_SAMPLES = 16000 * 20;

export interface DeskDelfiDeps {
  readonly preload: string;
  readonly page: string;
  readonly dataDir: string;
  readonly modelDir: string;
  /** 팀에 일을 맡긴다. 못 맡기면 null */
  submit(text: string): { readonly id: string } | null;
  /** rauha 창 열기(작업이 있으면 그 작업으로) */
  openMain(jobId: string | null): void;
  log(text: string): void;
  /** 돌아다닐 화면(작업표시줄을 뺀 영역). 평소엔 주 모니터 */
  area(): { x: number; y: number; width: number; height: number };
  /** 보이기·마이크 설정이 바뀌었을 때(알림 영역 메뉴 다시 그리기) */
  changed(): void;
}

interface Prefs {
  readonly visible: boolean;
  readonly mic: boolean;
  readonly voice: DelfiVoice;
}

/**
 * 바탕화면을 돌아다니는 델피(카페 지배인 모습). 부르면("델피~") 멈춰서 듣고, 말한 것을 팀에 맡기고, 일하는 동안은 일 모드.
 * 창 옮기기·마이크 소리 처리·받아쓰기를 잇기만 하고, 규칙은 DeskPet·Ear·WakeTemplates·SpokenText 에 있다.
 */
export class DeskDelfi {
  private window: BrowserWindow | null = null;
  private pet: DeskPet | null = null;
  private timer: NodeJS.Timeout | null = null;
  private ear = Ear.idle();
  private templates: WakeTemplates;
  private prefs: Prefs;
  private thinking = false;
  private lastView = '';
  private lastJob: string | null = null;
  private readonly transcriber: LocalTranscriber;
  private readonly speaker: LocalSpeaker;
  private readonly prefsFile: string;
  private readonly voiceFile: string;

  constructor(private readonly deps: DeskDelfiDeps) {
    this.prefsFile = join(deps.dataDir, 'desk-delfi.json');
    this.voiceFile = join(deps.dataDir, 'delfi-voice.json');
    this.prefs = readPrefs(this.prefsFile);
    this.templates = WakeTemplatesDto.from(readJson(this.voiceFile)).toEntity();
    this.speaker = new LocalSpeaker(deps.modelDir, deps.log);
    this.transcriber = new LocalTranscriber(deps.modelDir, (state, detail) => {
      if (state === 'failed') {
        deps.log(`받아쓰기 모델을 못 올림: ${detail ?? ''}`);
        this.speakAndSay('받아쓰기 준비에 실패했어요. 인터넷 연결을 확인해 주세요.', 6000);
      }
      if (state === 'ready' && this.prefs.mic) this.speakAndSay('이제 들을 수 있어요!', 3000, false);
      this.push();
    });
  }

  get visible(): boolean {
    return this.prefs.visible;
  }

  get micOn(): boolean {
    return this.prefs.mic;
  }

  /** IPC 를 보낸 쪽이 이 창(최상위 프레임)인지 */
  isSender(event: unknown): boolean {
    const e = event as IpcMainEvent;
    const w = this.window;
    return w !== null && !w.isDestroyed() && e.sender === w.webContents && e.senderFrame?.parent === null && (e.senderFrame?.url ?? '').startsWith('file:') && (e.senderFrame?.url ?? '').includes('/pet.html');
  }

  /** 이 창에서 오는 소리(마이크)만 허락한다. 그 밖의 권한·다른 창은 모두 거절 */
  allowsMedia(contents: WebContents, permission: string, mediaTypes: readonly string[] | undefined): boolean {
    const w = this.window;
    if (w === null || w.isDestroyed() || contents !== w.webContents || permission !== 'media' || !this.prefs.mic) return false;
    return mediaTypes === undefined || mediaTypes.every((t) => t === 'audio');
  }

  register(ipc: IpcMain): void {
    ipc.on(PET_IPC.segment, (_e, samples: unknown) => {
      if (!(samples instanceof Float32Array) || samples.length === 0 || samples.length > MAX_SAMPLES) return;
      void this.onSegment(samples).catch((error: unknown) => {
        this.thinking = false;
        this.deps.log(`음성 처리 실패: ${error instanceof Error ? error.message : String(error)}`);
        this.push();
      });
    });
    ipc.on(PET_IPC.hover, (_e, on: unknown) => this.window?.setIgnoreMouseEvents(on !== true, { forward: true }));
    ipc.on(PET_IPC.click, () => this.deps.openMain(this.lastJob));
    ipc.on(PET_IPC.menu, () => this.popupMenu());
    ipc.on(PET_IPC.micFailed, (_e, reason: unknown) => {
      this.deps.log(`마이크를 못 엶: ${String(reason)}`);
      this.setPrefs({ ...this.prefs, mic: false });
      this.speakAndSay('마이크를 열지 못했어요. Windows 설정 > 개인 정보 > 마이크를 확인해 주세요.', 7000);
    });
  }

  /** 앱이 켜질 때: 보이기로 해 둔 경우에만 띄운다 */
  start(): void {
    if (this.prefs.visible) this.show();
  }

  show(): void {
    this.setPrefs({ ...this.prefs, visible: true });
    if (this.window !== null && !this.window.isDestroyed()) return;
    const area = this.deps.area();
    this.pet = DeskPet.enter(area, SIZE, Date.now());
    const w = new BrowserWindow({
      ...SIZE,
      x: Math.round(this.pet.pos.x),
      y: Math.round(this.pet.pos.y),
      transparent: true,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      focusable: false,
      alwaysOnTop: true,
      show: false,
      backgroundColor: '#00000000',
      webPreferences: { preload: this.deps.preload, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
    });
    w.setAlwaysOnTop(true, 'floating');
    w.setIgnoreMouseEvents(true, { forward: true });
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    w.webContents.on('will-navigate', (event) => event.preventDefault());
    w.once('ready-to-show', () => {
      w.showInactive();
      this.push(true);
    });
    w.on('closed', () => {
      this.window = null;
      if (this.timer !== null) clearInterval(this.timer);
      this.timer = null;
    });
    void w.loadFile(this.deps.page);
    this.window = w;
    screen.on('display-metrics-changed', this.onDisplay);
    this.timer = setInterval(() => this.tick(), TICK_MS);
    if (this.prefs.mic) void this.transcriber.warm();
    if (this.prefs.voice !== 'off') void this.speaker.warm();
  }

  hide(): void {
    this.setPrefs({ ...this.prefs, visible: false });
    screen.off('display-metrics-changed', this.onDisplay);
    this.window?.destroy();
    this.window = null;
  }

  setMic(on: boolean): void {
    this.setPrefs({ ...this.prefs, mic: on });
    if (on) {
      if (!this.prefs.visible) this.show();
      void this.transcriber.warm();
      this.speakAndSay(this.templates.ready ? '"델피~" 하고 부르면 대답할게요.' : '듣고 있어요. 오른쪽 클릭 > "내 목소리로 이름 알려 주기"를 하면 더 잘 알아들어요.', 6000);
    } else {
      this.ear = this.ear.done();
      this.say('마이크를 껐어요.', 3000);
    }
    this.push();
  }

  /** 맡은 일들의 상태(보드가 바뀔 때마다). 일이 하나라도 남아 있으면 일 모드, 다 끝나면 기뻐한다 */
  observe(jobs: readonly { readonly id: string; readonly over: boolean; readonly done: boolean }[]): void {
    if (this.pet === null) return;
    const now = Date.now();
    const busy = jobs.some((j) => !j.over);
    const wasWorking = this.pet.mode === 'work';
    this.pet = busy ? this.pet.working(now) : this.pet.allDone(now);
    if (wasWorking && !busy) {
      const last = jobs.find((j) => j.id === this.lastJob);
      this.speakAndSay(last !== undefined && !last.done ? '일이 멈췄어요. 저를 눌러서 확인해 주세요.' : '다 했어요! 저를 누르면 결과를 보여 드릴게요.', 6000);
    }
    this.push();
  }

  /** 확인용 실행: 마이크로 들은 것처럼 소리 한 덩어리를 넣는다(받아쓰기가 끝날 때까지 기다린다) */
  async feed(samples: Float32Array): Promise<void> {
    // 진짜 마이크는 열지 않는다(방 소리가 섞이지 않게)
    await this.onSegment(samples, true);
  }

  /** 확인용 실행: 마이크 없이 이름 녹음을 시작한다(그다음 feed 로 녹음을 넣는다) */
  beginTrainingForTest(): void {
    this.templates = this.templates.reset();
    this.ear = this.ear.train();
  }

  /** 확인용 실행: 델피 창 안쪽만 그림 파일로 남긴다(바탕화면의 다른 창은 찍지 않는다) */
  async snapshot(file: string): Promise<void> {
    const w = this.window;
    if (w === null || w.isDestroyed()) return;
    const image = await w.webContents.capturePage();
    writeFileSync(file, image.toPNG());
    this.deps.log(`모습 ${this.pet?.mode ?? '-'} 창 ${JSON.stringify(w.getPosition())} 계산 ${JSON.stringify(this.pet?.pos)} 목적지 ${JSON.stringify(this.pet?.target)} 영역 ${JSON.stringify(this.pet?.area)} 말풍선 ${this.pet?.bubble(Date.now()) ?? '-'}`);
  }

  private readonly onDisplay = (): void => {
    if (this.pet !== null) this.pet = this.pet.within(this.deps.area());
  };

  private tick(): void {
    const w = this.window;
    if (w === null || w.isDestroyed() || this.pet === null) return;
    const before = this.pet.pos;
    this.pet = this.pet.step(Date.now(), Math.random);
    const { x, y } = this.pet.pos;
    if (Math.round(x) !== Math.round(before.x) || Math.round(y) !== Math.round(before.y)) w.setPosition(Math.round(x), Math.round(y));
    this.push();
  }

  private async onSegment(samples: Float32Array, test = false): Promise<void> {
    if ((!this.prefs.mic && !test) || this.pet === null) return;
    const now = Date.now();
    const ms = (samples.length / 16000) * 1000;
    const print = mfcc(samples);
    const match = this.templates.ready ? this.templates.match(print) : null;
    const action = this.ear.hear(now, match, ms);
    if (match !== null && action !== 'ignore') this.deps.log(`호출어 비교: ${action} 점수 ${match.score.toFixed(2)}`);
    switch (action) {
      case 'ignore':
        return;
      case 'sample':
        return this.addSample(print);
      case 'wake':
        return this.wake();
      case 'wake-with-command': {
        const cut = Math.min(samples.length, Math.round(((match?.endMs ?? 0) / 1000) * 16000));
        this.wake(false);
        return this.command(await this.listen(samples.subarray(cut)));
      }
      case 'confirm': {
        // 이름인지 애매한 말은 받아쓰기가 한가할 때만 확인한다(대기줄이 쌓여 늦어지지 않게)
        if (this.transcriber.busy) return;
        const heard = SpokenText.of(await this.listen(samples)).afterName();
        if (!heard.called) return;
        if (heard.rest === '' || SpokenText.of(heard.rest).isEmpty) return this.wake();
        this.wake(false);
        return this.command(heard.rest);
      }
      case 'command':
        return this.command(await this.listen(samples));
    }
  }

  private wake(answer = true): void {
    if (this.pet === null) return;
    const now = Date.now();
    this.ear = this.ear.awaitCommand(now);
    this.pet = this.pet.call(now);
    if (answer) this.speakAndSay('네? 말씀하세요.', 8000);
    this.push();
  }

  private command(text: string): void {
    const spoken = SpokenText.of(text);
    if (spoken.isEmpty) return; // 아직 기다리는 중(정한 시간이 지나면 저절로 쉰다)
    const now = Date.now();
    this.ear = this.ear.done();
    if (this.pet !== null) this.pet = this.pet.dismiss(now, Math.random);
    if (spoken.isCancel) {
      this.speakAndSay('알겠어요.', 2500);
      return;
    }
    const task = spoken.forTask();
    const job = this.deps.submit(task);
    this.deps.log(job === null ? '일 맡기기 실패' : `일 맡김 ${job.id}`);
    if (job === null) {
      this.speakAndSay('지금은 일을 맡을 수 없어요. 저를 눌러 rauha 창을 확인해 주세요.', 7000);
      return;
    }
    this.lastJob = job.id;
    if (this.pet !== null) this.pet = this.pet.working(now);
    this.say(`“${task.length > 40 ? `${task.slice(0, 40)}…` : task}” 맡을게요!`, 6000);
    this.speak('네, 맡을게요!');
    this.push();
  }

  private async listen(samples: Float32Array): Promise<string> {
    this.thinking = true;
    this.push();
    try {
      const started = Date.now();
      const text = await this.transcriber.transcribe(samples);
      // 말한 내용은 기록에 남기지 않는다(확인용 실행만 글을 남긴다)
      this.deps.log(`받아씀 ${text.length}자, ${Date.now() - started}ms${process.env['RAUHA_DELFI_FEED'] !== undefined ? `: ${text}` : ''}`);
      return text;
    } finally {
      this.thinking = false;
      this.push();
    }
  }

  private addSample(print: ReturnType<typeof mfcc>): void {
    const next = this.templates.add(print);
    if (next === this.templates) {
      this.say('조금 더 또렷하게 한 번 더요!', 4000);
      return;
    }
    this.templates = next;
    if (this.templates.count < WAKE_SAMPLES_NEEDED) {
      this.say(`좋아요! (${this.templates.count}/${WAKE_SAMPLES_NEEDED}) 한 번 더 "델피"`, 8000);
      return;
    }
    this.ear = this.ear.done();
    writeJson(this.voiceFile, WakeTemplatesDto.fromEntity(this.templates));
    this.speakAndSay('목소리 외웠어요! 이제 "델피~" 하고 불러 주세요.', 6000);
  }

  private startTraining(): void {
    if (!this.prefs.mic) this.setMic(true);
    this.templates = this.templates.reset();
    this.ear = this.ear.train();
    this.speakAndSay(`"델피"라고 ${WAKE_SAMPLES_NEEDED}번, 한 번씩 쉬면서 불러 주세요.`, 10_000);
  }

  private popupMenu(): void {
    const w = this.window;
    if (w === null) return;
    Menu.buildFromTemplate([
      { label: 'rauha 열기', click: () => this.deps.openMain(this.lastJob) },
      { type: 'separator' },
      { label: '"델피~" 듣기 (마이크)', type: 'checkbox', checked: this.prefs.mic, click: () => this.setMic(!this.prefs.mic) },
      { label: this.templates.ready ? '내 목소리로 이름 다시 알려 주기' : '내 목소리로 이름 알려 주기', click: () => this.startTraining() },
      {
        label: '목소리',
        submenu: [
          { label: '남자 (M3)', type: 'radio', checked: this.prefs.voice === 'M3', click: () => this.setVoice('M3') },
          { label: '여자 (F5)', type: 'radio', checked: this.prefs.voice === 'F5', click: () => this.setVoice('F5') },
          { label: '말하지 않기 (말풍선만)', type: 'radio', checked: this.prefs.voice === 'off', click: () => this.setVoice('off') },
        ],
      },
      { type: 'separator' },
      { label: '바탕화면 델피 숨기기', click: () => this.hide() },
    ]).popup({ window: w });
  }

  private say(text: string, ms: number): void {
    if (this.pet !== null) this.pet = this.pet.say(text, Date.now(), ms);
    this.push();
  }

  /** 로컬 말하기 모델로 소리를 만들어 델피 창에 틀게 한다. 모델을 아직 받는 중이거나 실패하면 말풍선만 남는다 */
  private speak(text: string): void {
    const voice = this.prefs.voice;
    if (voice === 'off') return;
    void this.speaker.speak(text, voice).then(
      (sound) => {
        const w = this.window;
        if (w !== null && !w.isDestroyed()) w.webContents.send(PET_IPC.speak, { audio: sound.audio, rate: sound.rate });
        this.deps.log(`말함 ${voice} ${(sound.audio.length / sound.rate).toFixed(1)}초`);
      },
      (error: unknown) => this.deps.log(`말하기 실패: ${error instanceof Error ? error.message : String(error)}`),
    );
  }

  private setVoice(voice: DelfiVoice): void {
    this.setPrefs({ ...this.prefs, voice });
    if (voice === 'off') {
      this.say('이제 말풍선으로만 말할게요.', 3000);
      return;
    }
    this.speakAndSay('이 목소리로 말할게요.', 3000);
  }

  private speakAndSay(text: string, ms: number, voice = true): void {
    this.say(text, ms);
    if (voice) this.speak(text.replace(/[“”"]/g, ''));
  }

  private micState(): MicState {
    if (!this.prefs.mic) return 'off';
    if (this.ear.training) return 'training';
    return this.transcriber.state === 'loading' ? 'loading' : 'on';
  }

  private push(force = false): void {
    const w = this.window;
    if (w === null || w.isDestroyed() || this.pet === null) return;
    const view: PetView = { mode: this.pet.mode, facing: this.pet.facing, bubble: this.pet.bubble(Date.now()), thinking: this.thinking, mic: this.micState() };
    const key = JSON.stringify(view);
    if (!force && key === this.lastView) return;
    this.lastView = key;
    w.webContents.send(PET_IPC.view, view);
  }

  private setPrefs(next: Prefs): void {
    const same = next.visible === this.prefs.visible && next.mic === this.prefs.mic && next.voice === this.prefs.voice;
    this.prefs = next;
    writeJson(this.prefsFile, next);
    if (!same) this.deps.changed();
  }
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

function writeJson(file: string, value: unknown): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(value));
  } catch {
    /* 못 적어도 이번 실행은 그대로 간다 */
  }
}

/** 처음에는 Windows 에서만 보이고, 마이크는 사용자가 켤 때까지 꺼 둔다 */
function readPrefs(file: string): Prefs {
  const raw = readJson(file) as { visible?: unknown; mic?: unknown; voice?: unknown } | null;
  return {
    visible: typeof raw?.visible === 'boolean' ? raw.visible : process.platform === 'win32',
    mic: raw?.mic === true,
    voice: toDelfiVoice(raw?.voice),
  };
}
