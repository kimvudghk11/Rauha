import { serverFailure } from './db-api.js';
import type { ServerAddresses } from './db-server.js';

/** 지금 붙어 있는 주소(화면에 "Connected via #2 Public · 3.35.12.4:5432" 로 보인다) */
export interface DbVia {
  /** 몇 번째 주소인지(0부터) */
  readonly index: number;
  /** 연결에 적힌 주소 수 */
  readonly total: number;
  readonly label: string | null;
  /** host:port */
  readonly endpoint: string;
}

/** 이 주소에서만 막힌 것일 수 있는 오류(접속 주소에 따라 허락이 다른 pg_hba) */
const PER_ADDRESS = /no pg_hba\.conf entry/i;

/**
 * 주소 여러 개로 접속하기(엔티티): 1번부터 차례로 시도하고, 닿지 않으면 다음 주소로 넘어간다.
 * 닿지 않음(거절·시간 초과·이름 없음·TLS·pg_hba)만 넘어가고, 비밀번호 틀림·DB 없음처럼 같은 DB 라 다음 주소도 같을 실패는 바로 멈춘다.
 */
export class AddressFailover {
  private readonly errors: { readonly index: number; readonly message: string }[] = [];
  private cursor = 0;
  private stopped = false;

  private constructor(private readonly addresses: ServerAddresses) {}

  static start(addresses: ServerAddresses): AddressFailover {
    return new AddressFailover(addresses);
  }

  /** 이 오류 뒤에 다음 주소를 시도할지 */
  static shouldTryNext(message: string): boolean {
    return PER_ADDRESS.test(message) || serverFailure(message).kind === 'no-server';
  }

  /** 다음에 시도할 주소 번호(0부터). 붙었거나 멈췄거나 다 해 봤으면 null */
  next(): number | null {
    return this.stopped || this.cursor >= this.addresses.size ? null : this.cursor;
  }

  /** index 번 주소가 실패했다 */
  failed(index: number, message: string): void {
    this.errors.push({ index, message });
    this.cursor = index + 1;
    if (!AddressFailover.shouldTryNext(message)) this.stopped = true;
  }

  /** index 번 주소에 붙었다 */
  connected(index: number): DbVia {
    this.stopped = true;
    const a = this.addresses.at(index);
    return { index, total: this.addresses.size, label: a.label, endpoint: a.endpoint() };
  }

  private name(index: number): string {
    const a = this.addresses.at(index);
    return `#${index + 1}${a.label === null ? '' : ` ${a.label}`} ${a.endpoint()}`;
  }

  /** 끝내 붙지 못했을 때 보일 글: 주소가 하나면 오류 그대로, 여럿이면 멈춘 주소의 오류 또는 주소마다 한 줄 */
  failureMessage(): string {
    const last = this.errors[this.errors.length - 1];
    if (last === undefined) return 'No host to connect to.';
    if (this.addresses.size === 1) return last.message;
    if (!AddressFailover.shouldTryNext(last.message)) return `${this.name(last.index)}: ${last.message}`;
    return [`Tried ${this.errors.length} addresses and none answered.`, ...this.errors.map((e) => `${this.name(e.index)}: ${e.message.split(/\r?\n/)[0] ?? ''}`)].join('\n');
  }
}
