import { describe, expect, it } from 'vitest';
import { StackTrace } from './stack-trace.js';

const repo = ['src/order/order.service.ts', 'src/order/order.ts', 'src/main/java/com/shop/order/OrderService.java', 'app/payment.py', 'pkg/pay/pay.go', 'src/util/index.ts', 'lib/util/index.ts'];

describe('에러 글의 스택 프레임 → 저장소 파일', () => {
  it('Node 스택(절대 경로·괄호 안·줄:칸)에서 저장소 파일과 줄을 찾는다', () => {
    const text = `TypeError: Cannot read properties of undefined (reading 'total')
    at OrderService.pay (/app/dist/../src/order/order.service.ts:42:17)
    at /app/src/order/order.ts:7:3
    at processTicksAndRejections (node:internal/process/task_queues:95:5)
    at Object.<anonymous> (/app/node_modules/express/lib/router.js:10:2)`;
    expect(StackTrace.hits(text, repo)).toEqual([
      { path: 'src/order/order.service.ts', line: 42 },
      { path: 'src/order/order.ts', line: 7 },
    ]);
  });

  it('Windows 경로도 찾는다', () => {
    expect(StackTrace.hits('at E:\\work\\shop\\src\\order\\order.ts:12:1', repo)).toEqual([{ path: 'src/order/order.ts', line: 12 }]);
  });

  it('Java 스택은 패키지 경로로 파일을 찾는다', () => {
    const text = `java.lang.NullPointerException
\tat com.shop.order.OrderService.pay(OrderService.java:88)
\tat org.springframework.aop.Proxy.invoke(Proxy.java:20)`;
    expect(StackTrace.hits(text, repo)).toEqual([{ path: 'src/main/java/com/shop/order/OrderService.java', line: 88 }]);
  });

  it('Python·Go 스택도 찾는다', () => {
    expect(StackTrace.hits('  File "/srv/app/payment.py", line 31, in charge', repo)).toEqual([{ path: 'app/payment.py', line: 31 }]);
    expect(StackTrace.hits('\t/home/u/shop/pkg/pay/pay.go:55 +0x1d', repo)).toEqual([{ path: 'pkg/pay/pay.go', line: 55 }]);
  });

  it('이름만 같은 파일이 여럿이라 어느 것인지 모르면 넣지 않는다(추측하지 않는다)', () => {
    expect(StackTrace.hits('at x (index.ts:3:1)', repo)).toEqual([]);
  });

  it('같은 파일·줄은 한 번만, 최대 개수까지만', () => {
    const text = Array.from({ length: 20 }, (_, i) => `at /app/src/order/order.ts:${i % 12}:1`).join('\n');
    const hits = StackTrace.hits(text, repo, 5);
    expect(hits).toHaveLength(5);
    expect(new Set(hits.map((h) => h.line)).size).toBe(5);
  });

  it('스택이 없는 글이면 빈 목록', () => {
    expect(StackTrace.hits('결제가 두 번 깎여요', repo)).toEqual([]);
  });
});
