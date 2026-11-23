// 태스크 측정용 예제 레포를 만든다: 의존성 없는 JS(node --test) + 긴 SPEC·DESIGN 문서(실제 사용처럼 여러 절).
// 쓰는 법: node packages/desktop/scripts/bench-fixture.mjs <만들 폴더>
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (dir === undefined) throw new Error('만들 폴더를 주세요');
mkdirSync(join(dir, 'src'), { recursive: true });
mkdirSync(join(dir, 'test'), { recursive: true });
mkdirSync(join(dir, 'docs'), { recursive: true });

writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'shop-bench', version: '1.0.0', type: 'module', scripts: { test: 'node --test' } }, null, 2));
writeFileSync(join(dir, '.gitignore'), 'node_modules\n');
writeFileSync(
  join(dir, 'src', 'cart.js'),
  `/** 장바구니. 금액은 원 단위 정수 */
export function createCart() {
  return { items: [] };
}

export function addItem(cart, item) {
  if (!Number.isInteger(item.price) || item.price < 0) throw new Error('price must be a non-negative integer');
  if (!Number.isInteger(item.qty) || item.qty <= 0) throw new Error('qty must be a positive integer');
  const found = cart.items.find((i) => i.sku === item.sku);
  if (found) found.qty += item.qty;
  else cart.items.push({ ...item });
  return cart;
}

export function subtotal(cart) {
  return cart.items.reduce((sum, i) => sum + i.price * i.qty, 0);
}
`,
);
writeFileSync(
  join(dir, 'src', 'shipping.js'),
  `/** 배송비: 3만 원 이상 무료, 아니면 3000원 */
export function shippingFee(amount) {
  return amount >= 30000 ? 0 : 3000;
}
`,
);
writeFileSync(
  join(dir, 'test', 'cart.test.js'),
  `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addItem, createCart, subtotal } from '../src/cart.js';

test('같은 상품을 담으면 수량이 늘어난다', () => {
  const c = createCart();
  addItem(c, { sku: 'A', price: 1000, qty: 1 });
  addItem(c, { sku: 'A', price: 1000, qty: 2 });
  assert.equal(c.items.length, 1);
  assert.equal(subtotal(c), 3000);
});
`,
);

// 긴 문서: 실제 사용에서 문제였던 "SPEC/DESIGN 통째로 붙이기"를 재현하려고 절을 많이 둔다
const section = (n, title, body) => `## ${n}. ${title}\n\n${body}\n`;
const filler = (topic, k) =>
  Array.from({ length: k }, (_, i) => `- ${topic} 규칙 ${i + 1}: 이 항목은 ${topic}의 세부 동작을 설명한다. 운영 중 문의가 많았던 경우를 정리했고, 화면 문구와 로그 형식, 예외 상황에서의 처리 순서를 함께 적는다.`).join('\n');
const spec = [
  '# 쇼핑몰 SPEC\n',
  section(1, '개요', '작은 쇼핑몰의 장바구니·결제 전 단계 규칙을 정한다. 금액은 모두 원 단위 정수다.'),
  section(2, '회원', filler('회원 등급', 18)),
  section(3, '장바구니', '### 3.1 담기\n같은 SKU 는 수량을 합친다. 가격은 0 이상 정수, 수량은 1 이상 정수.\n\n### 3.2 쿠폰\n- 쿠폰은 { code, type, value } 이다. type 은 "rate"(퍼센트) 또는 "fixed"(원).\n- applyCoupon(cart, coupon) 은 할인 금액을 돌려준다.\n- rate 쿠폰: 소계 × value / 100 을 원 단위로 내림. value 는 1~90.\n- fixed 쿠폰: value 원. 소계보다 크면 소계까지만 할인.\n- 소계가 0 이면 할인도 0.\n- 잘못된 쿠폰(type 이 다르거나 value 범위 밖)은 Error 를 던진다.\n\n' + filler('장바구니 표시', 10)),
  section(4, '배송', filler('배송', 20)),
  section(5, '결제', filler('결제 수단', 22)),
  section(6, '환불', filler('환불', 20)),
  section(7, '알림', filler('알림 메일', 16)),
  section(8, '관리자', filler('관리자 화면', 20)),
].join('\n');
writeFileSync(join(dir, 'docs', 'SPEC.md'), spec);
const design = ['# DESIGN\n', section(1, '구조', 'src/ 아래 기능별 파일 하나. 순수 함수로 두고 상태는 인자로 받는다.'), section(2, '오류', '잘못된 입력은 Error 를 던진다. 메시지는 영어 소문자.'), section(3, '화면', filler('화면 배치', 25)), section(4, '로그', filler('로그 형식', 20))].join('\n');
writeFileSync(join(dir, 'docs', 'DESIGN.md'), design);
writeFileSync(join(dir, 'CLAUDE.md'), '# shop-bench\n\n- 규칙은 docs/SPEC.md, 구조는 docs/DESIGN.md 를 따른다.\n- 테스트: npm test (node --test)\n');

execFileSync('git', ['init', '-q'], { cwd: dir });
execFileSync('git', ['add', '.'], { cwd: dir });
execFileSync('git', ['-c', 'user.name=bench', '-c', 'user.email=bench@example.invalid', 'commit', '-q', '-m', 'init'], { cwd: dir });
console.log(`fixture ready: ${dir} (SPEC ${spec.length} chars, DESIGN ${design.length} chars)`);
