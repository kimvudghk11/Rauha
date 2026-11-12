import { describe, expect, it } from 'vitest';
import { DbPassword, SavedPassword } from '../../shared/db-server.js';
import { safeStorageBox, ServerPasswords, type SafeStorageLike } from './server-passwords.js';

const storage = (available: boolean, backend?: string): SafeStorageLike => ({
  isEncryptionAvailable: () => available,
  encryptString: (plain) => Buffer.from(`E(${plain})`),
  decryptString: (sealed) => sealed.toString().slice(2, -1),
  ...(backend === undefined ? {} : { getSelectedStorageBackend: () => backend }),
});

describe('safeStorage 암호 상자', () => {
  it('암호문은 base64 로 저장하고 다시 풀린다', () => {
    const box = safeStorageBox(storage(true), 'darwin');
    const sealed = box.seal('pw');
    expect(sealed).toBe(Buffer.from('E(pw)').toString('base64'));
    expect(box.open(sealed)).toBe('pw');
  });
  it('암호화를 못 쓰거나, 리눅스에서 basic_text(평문)로 떨어지면 쓸 수 없다고 본다', () => {
    expect(safeStorageBox(storage(false), 'win32').available()).toBe(false);
    expect(safeStorageBox(storage(true, 'basic_text'), 'linux').available()).toBe(false);
    expect(safeStorageBox(storage(true, 'gnome_libsecret'), 'linux').available()).toBe(true);
  });
});

describe('서버 비밀번호 찾기', () => {
  it('이번 실행에서 받은 비밀번호가 먼저고, 없으면 저장한 암호문을 풀고, 둘 다 없으면 null', () => {
    const p = new ServerPasswords(safeStorageBox(storage(true), 'win32'));
    const saved = p.toSaved(DbPassword.parse('stored'), true);
    expect(p.resolve('a', saved)?.reveal()).toBe('stored');
    p.remember('a', DbPassword.parse('typed'));
    expect(p.resolve('a', saved)?.reveal()).toBe('typed');
    p.forget('a');
    expect(p.resolve('a', SavedPassword.none())).toBeNull();
  });
  it('암호화를 못 쓰는 컴퓨터에서는 저장하지 않는다', () => {
    const p = new ServerPasswords(safeStorageBox(storage(false), 'win32'));
    expect(p.canSave()).toBe(false);
    expect(p.toSaved(DbPassword.parse('x'), true).isSaved()).toBe(false);
  });
});
