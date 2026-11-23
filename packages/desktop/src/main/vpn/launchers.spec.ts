import { describe, expect, it } from 'vitest';
import { openvpnArgs, serviceReply, serviceRequest } from './launchers.js';

const req = { configPath: 'C:\\Users\\me\\AppData\\Roaming\\rauha\\vpn-run\\id1.ovpn', workDir: 'C:\\Users\\me\\AppData\\Roaming\\rauha\\vpn-run', managementPort: 4555 };

describe('OpenVPN 띄우기', () => {
  it('management 를 127.0.0.1 에만 열고, 붙을 때까지 기다리게 한다', () => {
    const a = openvpnArgs(req);
    expect(a.slice(0, 6)).toEqual(['--config', req.configPath, '--management', '127.0.0.1', '4555', '--management-hold']);
  });

  it('Interactive Service 요청은 UTF-16LE "작업 폴더\\0옵션\\0\\0" 이고 빈칸 든 경로는 따옴표로 감싼다', () => {
    const text = serviceRequest('C:\\My Dir', ['--config', 'C:\\My Dir\\a.ovpn', '--verb', '3']).toString('utf16le');
    expect(text).toBe('C:\\My Dir\0--config "C:\\My Dir\\a.ovpn" --verb 3\0\0');
  });

  it('서비스 답 0x0 은 성공이다', () => {
    expect(serviceReply(Buffer.from('0x00000000\nProcess ID\n1234\0', 'utf16le'))).toBeNull();
  });

  it('권한 거절은 무엇을 하면 되는지 알려 준다', () => {
    const why = serviceReply(Buffer.from('0x20000000\nopenvpnserv\nUser is not authorized to start this config\0', 'utf16le'));
    expect(why).toMatch(/OpenVPN Administrators/);
  });

  it('그 밖의 실패는 서비스가 준 이유를 그대로 붙인다', () => {
    expect(serviceReply(Buffer.from('0x00000002\nCreateProcess\nfile not found\0', 'utf16le'))).toBe('OpenVPN could not start: file not found');
  });
});
