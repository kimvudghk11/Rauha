import { writeFileSync } from 'node:fs';
import type { BrowserWindow } from 'electron';

/**
 * 확인용: 메인 입력창에 글자를 넣고 "입력 → 다음 화면 그리기"까지 걸린 시간을 잰다(RAUHA_MEASURE_TYPING=결과 json 경로).
 * 키 입력(sendInputEvent)과 한글 조합 확정(insertText) 두 가지를 잰다. 긴 작업(longtask)도 함께 모은다.
 */
export async function measureTyping(window: BrowserWindow, out: string, busy: () => void): Promise<void> {
  const wc = window.webContents;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  await wc.executeJavaScript(`(() => {
    const ta = document.querySelector('textarea');
    ta.focus();
    window.__lat = []; window.__long = [];
    let t0 = null;
    ta.addEventListener('keydown', (e) => { t0 = performance.now(); }, true);
    ta.addEventListener('beforeinput', () => { if (t0 === null) t0 = performance.now(); }, true);
    ta.addEventListener('input', () => {
      const start = t0 ?? performance.now(); t0 = null;
      requestAnimationFrame(() => requestAnimationFrame(() => window.__lat.push(performance.now() - start)));
    });
    new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__long.push(Math.round(e.duration)))).observe({ entryTypes: ['longtask'] });
    return true;
  })()`);

  const run = async (label: string) => {
    window.setAlwaysOnTop(true);
    window.show();
    window.moveTop();
    window.focus();
    wc.focus();
    await wc.executeJavaScript('(() => { window.__lat = []; window.__long = []; const ta = document.querySelector("textarea"); ta.value = ""; ta.focus(); return true; })()');
    for (const ch of 'abcdefghijklmnopqrstuvwxyz') {
      wc.sendInputEvent({ type: 'keyDown', keyCode: ch });
      wc.sendInputEvent({ type: 'char', keyCode: ch });
      wc.sendInputEvent({ type: 'keyUp', keyCode: ch });
      await sleep(60);
    }
    await sleep(300);
    const keys = (await wc.executeJavaScript('window.__lat.slice()')) as number[];
    await wc.executeJavaScript('window.__lat = []; true');
    for (const word of ['결제', '타임아웃', '원인', '찾아줘', '온보딩', '시안', '주간보고', '정리']) {
      wc.insertText(word);
      await sleep(80);
    }
    await sleep(300);
    const ime = (await wc.executeJavaScript('window.__lat.slice()')) as number[];
    const long = (await wc.executeJavaScript('window.__long.slice()')) as number[];
    const stat = (xs: number[]) => {
      const s = [...xs].sort((a, b) => a - b);
      const at = (p: number) => Math.round((s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0) * 10) / 10;
      return { n: s.length, p50: at(0.5), p95: at(0.95), max: at(1) };
    };
    const vis = (await wc.executeJavaScript('document.visibilityState + "/" + document.hasFocus()')) as string;
    return { label, vis, keys: stat(keys), ime: stat(ime), longTasks: long, jank: await jank() };
  };

  /** 2초 동안 프레임 간격을 재서 50ms 넘는 끊김 수와 가장 긴 간격 */
  const jank = async () =>
    (await wc.executeJavaScript(`new Promise((done) => {
      const gaps = []; let last = performance.now(); const end = last + 2000;
      const step = (t) => { gaps.push(t - last); last = t; if (t < end) requestAnimationFrame(step); else done({ frames: gaps.length, over50: gaps.filter((g) => g > 50).length, worst: Math.round(Math.max(...gaps)) }); };
      requestAnimationFrame(step);
    })`)) as unknown;

  // 한글 조합 흉내(CDP): 조합 중 글자 갱신 시간과, 조합 중에 Enter를 누르면 보내지는지.
  const ime = async () => {
    wc.debugger.attach('1.3');
    const cdp = (method: string, params: Record<string, unknown>) => wc.debugger.sendCommand(method, params);
    await wc.executeJavaScript(`(() => { const ta = document.querySelector('textarea'); ta.value = ''; ta.focus();
      window.__comp = []; let t0 = null;
      ta.addEventListener('compositionupdate', () => { const s = performance.now(); requestAnimationFrame(() => requestAnimationFrame(() => window.__comp.push(performance.now() - s))); });
      return true; })()`);
    for (const step of ['ㄱ', '거', '결', '결ㅈ', '결제']) {
      await cdp('Input.imeSetComposition', { text: step, selectionStart: step.length, selectionEnd: step.length });
      await sleep(60);
    }
    // 조합이 끝나지 않은 채 Enter
    const sentBefore = (await wc.executeJavaScript('document.querySelectorAll(".m.me").length')) as number;
    await cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await cdp('Input.dispatchKeyEvent', { type: 'char', key: 'Enter', text: '\r', windowsVirtualKeyCode: 13 });
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await sleep(400);
    const sentAfter = (await wc.executeJavaScript('document.querySelectorAll(".m.me").length')) as number;
    const left = (await wc.executeJavaScript('document.querySelector("textarea").value')) as string;
    const comp = (await wc.executeJavaScript('window.__comp.slice()')) as number[];
    wc.debugger.detach();
    return { compositionPaintMs: comp.map((x) => Math.round(x * 10) / 10), enterWhileComposingSent: sentAfter > sentBefore, textLeft: left };
  };
  const composing = await ime();

  const idle = await run('일 없음');
  busy();
  await sleep(500);
  const withJobs = await run('일 5개');
  const { app } = await import('electron');
  writeFileSync(out, JSON.stringify({ composing, idle, withJobs, gpu: app.getGPUFeatureStatus() }, null, 2));
}
