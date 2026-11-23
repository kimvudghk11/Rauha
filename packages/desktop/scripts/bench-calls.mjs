// session-bench 기록(calls.jsonl)을 역할별 표로: 첫 맥락(쓰기+읽기)·출력·턴·도구
// 쓰는 법: node packages/desktop/scripts/bench-calls.mjs <기록 폴더>
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const lines = readFileSync(join(process.argv[2], 'calls.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
let total = { w: 0, r: 0, o: 0 };
const rows = [];
for (const c of lines) {
  if (c.turn !== undefined) {
    rows.push(`\n[${c.turn}]`);
    continue;
  }
  let w = 0, r = 0, o = 0, i = 0;
  for (const [model, u] of Object.entries(c.models ?? {})) {
    if (model.includes('haiku')) continue; // SDK 안쪽 보조 호출(제목 등)
    w += u.cacheWrite; r += u.cacheRead; o += u.out; i += u.in;
  }
  total = { w: total.w + w + i, r: total.r + r, o: total.o + o };
  const tools = (c.tools ?? []).map((t) => `${t.name.replace('mcp__rauha__', 'r:')}×${t.count}`).join(' ');
  rows.push(`${c.role.padEnd(12)} ${c.model.replace('claude-', '').padEnd(10)} ${c.resumed ? 'resume' : 'new   '} turns=${String(c.turns).padStart(2)} write=${String(w + i).padStart(6)} read=${String(r).padStart(7)} out=${String(o).padStart(5)} ${tools}`);
}
console.log(rows.join('\n'));
console.log(`\nTOTAL write=${total.w} read=${total.r} out=${total.o}  (가중 ≈ write×1.25 + read×0.1 + out×5 = ${Math.round(total.w * 1.25 + total.r * 0.1 + total.o * 5)})`);
