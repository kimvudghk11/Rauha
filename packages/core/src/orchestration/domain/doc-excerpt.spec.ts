import { describe, expect, it } from 'vitest';
import { DocExcerpt } from './doc-excerpt.js';

const filler = (topic: string, k: number): string => Array.from({ length: k }, (_, i) => `- ${topic} 규칙 ${i + 1}: 운영 중 문의가 많았던 경우를 정리했고 화면 문구와 로그 형식을 함께 적는다.`).join('\n');
const SPEC = [
  '# 쇼핑몰 SPEC',
  '',
  '## 1. 개요',
  '금액은 모두 원 단위 정수다.',
  '',
  '## 2. 회원',
  filler('회원 등급', 30),
  '',
  '## 3. 장바구니',
  '### 3.1 담기',
  '같은 SKU 는 수량을 합친다.',
  '',
  '### 3.2 쿠폰',
  '- applyCoupon(cart, coupon) 은 할인 금액을 돌려준다.',
  '- rate 쿠폰: 소계 × value / 100 을 내림.',
  '',
  '## 4. 배송',
  filler('배송', 30),
  '',
  '## 5. 결제',
  filler('결제 수단', 30),
].join('\n');

describe('긴 문서 발췌', () => {
  it('짧은 문서는 그대로 둔다', () => {
    expect(DocExcerpt.of('docs/a.md', '# 짧다\n내용', 'anything').isWhole()).toBe(true);
  });

  it('문서가 아닌 파일(코드)은 길어도 그대로 둔다', () => {
    expect(DocExcerpt.of('src/cart.js', 'x'.repeat(20_000), 'applyCoupon').isWhole()).toBe(true);
  });

  it('요청이 말한 절 번호(3.2)의 절을 넣고, 다른 절 본문은 뺀다', () => {
    const e = DocExcerpt.of('docs/SPEC.md', SPEC, 'docs/SPEC.md 3.2절 쿠폰 규칙대로 applyCoupon 을 추가해줘');
    const text = e.text();
    expect(e.isWhole()).toBe(false);
    expect(text).toContain('applyCoupon(cart, coupon) 은 할인 금액을 돌려준다');
    expect(text).not.toContain('결제 수단 규칙 3');
    expect(text).not.toContain('배송 규칙 3');
    expect(text.length).toBeLessThan(SPEC.length / 3);
  });

  it('목차(모든 제목)는 줄 번호와 함께 남겨 필요하면 그 절을 열 수 있게 한다', () => {
    const text = DocExcerpt.of('docs/SPEC.md', SPEC, '3.2 쿠폰').text();
    const lines = SPEC.split('\n');
    const pay = lines.indexOf('## 5. 결제') + 1;
    expect(text).toContain(`${pay}\t## 5. 결제`);
    expect(text).toMatch(/Read/);
  });

  it('넣은 절의 줄 번호는 원래 파일과 같다(Read 와 맞춘다)', () => {
    const text = DocExcerpt.of('docs/SPEC.md', SPEC, '3.2 쿠폰').text();
    const at = SPEC.split('\n').indexOf('- applyCoupon(cart, coupon) 은 할인 금액을 돌려준다.') + 1;
    expect(text).toContain(`${at}\t- applyCoupon(cart, coupon) 은 할인 금액을 돌려준다.`);
  });

  it('절 번호가 없으면 요청의 낱말(식별자·한글 낱말)이 가장 많이 나오는 절을 넣는다', () => {
    const text = DocExcerpt.of('docs/SPEC.md', SPEC, 'applyCoupon 쿠폰 할인 추가').text();
    expect(text).toContain('rate 쿠폰');
    expect(text).not.toContain('회원 등급 규칙 5');
  });

  it('맞는 절이 하나도 없으면 앞부분과 목차를 준다', () => {
    const text = DocExcerpt.of('docs/SPEC.md', SPEC, 'zzz 없는 말').text();
    expect(text).toContain('## 1. 개요');
    expect(text.length).toBeLessThan(SPEC.length / 2);
  });

  it('제목이 없는 긴 마크다운은 그대로 둔다(나눌 곳이 없다)', () => {
    expect(DocExcerpt.of('docs/notes.md', filler('메모', 200), '메모').isWhole()).toBe(true);
  });
});
