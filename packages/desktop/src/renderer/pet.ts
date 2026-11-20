/**
 * 바탕화면 델피 창: 카페 지배인 모습의 델피를 그리고, 마이크 소리를 말 덩어리로 잘라 main 에 보낸다.
 * 받아쓰기·호출어 판단은 main 이 한다. 이 화면은 그리기·소리 받기·소리 내어 말하기만.
 */
import type { PetBridge, PetView } from '../shared/desk-pet-ipc.js';
import { SpeechGate, toSixteenK } from '../shared/voice/speech-gate.js';
import { useCharacterSet, type CharacterState } from './characters.js';
import { pixelArt } from './pixel-art.js';

declare global {
  interface Window {
    readonly pet: PetBridge;
  }
}

const SCALE = 5;
const CANVAS = { width: 240, height: 110 } as const;
const ROLE = 'intake' as const;

useCharacterSet('cafe');

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const bubble = document.getElementById('bubble') as HTMLDivElement;
const micDot = document.getElementById('mic') as HTMLDivElement;
canvas.width = CANVAS.width;
canvas.height = CANVAS.height;
const ctx = canvas.getContext('2d')!;
ctx.imageSmoothingEnabled = false;

const { w: cw, h: ch } = pixelArt.size(ROLE);
const cellX = Math.floor((CANVAS.width / SCALE - cw) / 2);
const cellY = CANVAS.height / SCALE - ch - 1;

let view: PetView = { mode: 'pause', facing: 'left', bubble: null, thinking: false, mic: 'off' };
let tick = 0;

function stateOf(v: PetView): CharacterState {
  if (v.thinking) return 'think';
  switch (v.mode) {
    case 'listen':
      return 'wait';
    case 'work':
      return 'work';
    case 'cheer':
      return 'done';
    case 'nap':
      return 'rest';
    default:
      return 'idle';
  }
}

function draw(): void {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // 걸을 때는 한 걸음마다 살짝 통통 튄다
  const bob = view.mode === 'roam' && (tick >> 1) % 2 === 1 ? -1 : 0;
  pixelArt.draw(ctx, ROLE, stateOf(view), tick, { x: cellX, y: cellY + bob, scale: SCALE, flip: view.facing === 'right', seed: 0 });
}

setInterval(() => {
  tick += 1;
  draw();
}, 120);

// ── 마우스: 델피·말풍선 위에서만 클릭을 받고, 나머지는 뒤의 바탕화면으로 지나간다 ──
let hovering = false;
function overDelfi(x: number, y: number): boolean {
  const top = canvas.offsetTop + (cellY - 1) * SCALE;
  const left = (cellX - 1) * SCALE;
  if (x >= left && x <= left + (cw + 2) * SCALE && y >= top && y <= top + (ch + 3) * SCALE) return true;
  if (bubble.hidden) return false;
  const r = bubble.getBoundingClientRect();
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}
window.addEventListener('mousemove', (e) => {
  const on = overDelfi(e.clientX, e.clientY);
  if (on === hovering) return;
  hovering = on;
  document.body.style.cursor = on ? 'pointer' : 'default';
  window.pet.hover(on);
});
window.addEventListener('mouseleave', () => {
  if (!hovering) return;
  hovering = false;
  window.pet.hover(false);
});
window.addEventListener('click', (e) => {
  if (overDelfi(e.clientX, e.clientY)) window.pet.click();
});
window.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (overDelfi(e.clientX, e.clientY)) window.pet.menu();
});

// ── 마이크 ──
let mic: { stop(): void } | null = null;
let speakingUntil = 0;

async function openMic(): Promise<{ stop(): void }> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
  const audio = new AudioContext();
  const source = audio.createMediaStreamSource(stream);
  // ScriptProcessor 는 오래된 방식이지만 파일 하나로 끝나서(CSP·worklet 파일 없이) 여기서는 이것으로 충분하다
  const proc = audio.createScriptProcessor(2048, 1, 1);
  const mute = audio.createGain();
  mute.gain.value = 0;
  const gate = SpeechGate.start(audio.sampleRate);
  proc.onaudioprocess = (e) => {
    // 델피가 말하는 동안은 자기 목소리를 듣지 않는다
    if (performance.now() < speakingUntil) return;
    const seg = gate.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    micDot.dataset['voice'] = gate.inSpeech ? '1' : '0';
    if (seg !== null) window.pet.sendSegment(toSixteenK(seg, audio.sampleRate));
  };
  source.connect(proc);
  proc.connect(mute);
  mute.connect(audio.destination);
  return {
    stop() {
      proc.disconnect();
      source.disconnect();
      for (const t of stream.getTracks()) t.stop();
      void audio.close();
    },
  };
}

function syncMic(want: boolean): void {
  if (want && mic === null) {
    mic = { stop() {} };
    openMic().then(
      (m) => {
        if (view.mic === 'off') m.stop();
        else mic = m;
      },
      (error: unknown) => {
        mic = null;
        window.pet.micFailed(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
      },
    );
  } else if (!want && mic !== null) {
    mic.stop();
    mic = null;
  }
}

// ── 소리 내어 말하기(Windows 기본 한국어 목소리) ──
function koreanVoice(): SpeechSynthesisVoice | null {
  const voices = speechSynthesis.getVoices();
  return voices.find((v) => v.lang === 'ko-KR' && /Heami|SunHi|InJoon/i.test(v.name)) ?? voices.find((v) => v.lang.startsWith('ko')) ?? null;
}
speechSynthesis.onvoiceschanged = () => undefined;

window.pet.onSpeak((text) => {
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ko-KR';
  const voice = koreanVoice();
  if (voice !== null) u.voice = voice;
  u.rate = 1.05;
  u.pitch = 1.1;
  speakingUntil = performance.now() + 60_000;
  u.onend = () => (speakingUntil = performance.now() + 400);
  u.onerror = () => (speakingUntil = 0);
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
});

window.pet.onView((next) => {
  view = next;
  bubble.hidden = next.bubble === null;
  if (next.bubble !== null) bubble.textContent = next.bubble;
  micDot.hidden = next.mic === 'off';
  micDot.dataset['state'] = next.mic;
  syncMic(next.mic !== 'off');
  draw();
});

draw();
