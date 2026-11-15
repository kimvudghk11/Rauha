// 맥 메뉴 막대용 돌고래 실루엣(템플릿 이미지: 검정 + 투명)을 만든다. 앱 아이콘은 배경이 꽉 차 있어서 메뉴 막대에서 검은 네모로 보인다.
// 사용: electron scripts/make-tray-icon.cjs  →  build/trayTemplate.png(18px) · build/trayTemplate@2x.png(36px)
// 이미지 도구 없이 Electron 이 SVG 를 그려 투명 PNG 로 찍는다.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

// 32×32 돌고래(Delfi): 둥근 몸 + 등지느러미 + 꼬리, 눈은 구멍(evenodd). 18px 에서도 읽히게 단순하게.
const SVG = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32">
<path fill="#000" fill-rule="evenodd" d="
M4.5 17.5C4.5 11.6 9.2 7.5 14.8 7.5c.9-2 2.6-3.5 4.9-4-.7 1.6-.8 3.3-.2 4.9 3.3 1.7 5.5 4.8 5.8 8.5l2.7-2.1c1-.8 2.4.1 2.1 1.4l-.9 3.4 2.7 1.5c1.1.6.8 2.2-.4 2.4l-3.9.7c-1.6 3.6-5.6 6.1-11.4 6.1-6.6 0-11.7-4.8-11.7-11.8z
M10.8 13.6a1.8 1.8 0 1 0 0 3.6a1.8 1.8 0 1 0 0-3.6z"/>
</svg>`;

app.disableHardwareAcceleration();
// 크기마다 창을 닫았다 여니, 마지막 창이 닫혀도 앱이 끝나지 않게 한다
app.on('window-all-closed', () => undefined);
app.whenReady().then(async () => {
  try {
  const out = path.join(__dirname, '..', 'build');
  for (const [size, name] of [[18, 'trayTemplate.png'], [36, 'trayTemplate@2x.png'], [128, 'tray-preview.png']]) {
    const win = new BrowserWindow({ width: size, height: size, show: false, frame: false, transparent: true, useContentSize: true, webPreferences: { offscreen: true } });
    const page = path.join(require('node:os').tmpdir(), `rauha-tray-${size}.html`);
    fs.writeFileSync(page, `<html><body style="margin:0;background:transparent;overflow:hidden">${SVG(size)}</body></html>`);
    await win.loadFile(page);
    await new Promise((r) => setTimeout(r, 300));
    const img = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
    fs.writeFileSync(path.join(name === 'tray-preview.png' ? require('node:os').tmpdir() : out, name), img.resize({ width: size, height: size }).toPNG());
    win.destroy();
  }
  console.log('build/trayTemplate.png · trayTemplate@2x.png');
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  }
  app.quit();
});
