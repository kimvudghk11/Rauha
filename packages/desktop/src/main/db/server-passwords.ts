import { DbPassword, SavedPassword } from '../../shared/db-server.js';

/** 운영체제 암호화(Electron safeStorage)를 감싼 것. 시험에서는 가짜로 바꾼다. */
export interface SecretBox {
  /** 이 컴퓨터에서 암호화를 쓸 수 있는지 */
  available(): boolean;
  /** 평문 → 암호문(base64) */
  seal(plain: string): string;
  /** 암호문(base64) → 평문. 못 풀면 던진다 */
  open(sealed: string): string;
}

/** Electron safeStorage 에서 쓰는 부분 */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(sealed: Buffer): string;
  getSelectedStorageBackend?(): string;
}

/**
 * safeStorage 로 만든 암호 상자. 맥은 키체인, 윈도우는 DPAPI 로 사용자 계정에 묶인 키를 쓴다.
 * 리눅스에서 키링이 없어 basic_text(사실상 평문)로 떨어지면 "쓸 수 없음"으로 보고 저장하지 않는다.
 */
export function safeStorageBox(storage: SafeStorageLike, platform: string = process.platform): SecretBox {
  return {
    available: () => storage.isEncryptionAvailable() && !(platform === 'linux' && storage.getSelectedStorageBackend?.() === 'basic_text'),
    seal: (plain) => storage.encryptString(plain).toString('base64'),
    open: (sealed) => storage.decryptString(Buffer.from(sealed, 'base64')),
  };
}

/**
 * 서버 비밀번호를 어디서 가져올지: 이번 실행에서 받은 것(메모리) → 저장해 둔 암호문을 푼 것 → 없으면 물어야 한다.
 * 평문은 main 메모리에만 있고 파일·화면·로그로 나가지 않는다.
 */
export class ServerPasswords {
  private readonly known = new Map<string, DbPassword>();

  constructor(private readonly box: SecretBox) {}

  canSave(): boolean {
    try {
      return this.box.available();
    } catch {
      return false;
    }
  }

  /** 저장할 모양: 원하고 암호화할 수 있으면 암호문, 아니면 저장하지 않음 */
  toSaved(password: DbPassword, wanted: boolean): SavedPassword {
    return SavedPassword.keep(password, this.canSave() ? (plain) => this.box.seal(plain) : null, wanted);
  }

  resolve(id: string, saved: SavedPassword): DbPassword | null {
    const known = this.known.get(id);
    if (known !== undefined) return known;
    const sealed = saved.sealedText();
    if (sealed === null || !this.canSave()) return null;
    try {
      return DbPassword.parse(this.box.open(sealed));
    } catch {
      return null;
    }
  }

  /** 이번 실행 동안 기억한다 */
  remember(id: string, password: DbPassword): void {
    this.known.set(id, password);
  }

  forget(id: string): void {
    this.known.delete(id);
  }
}
