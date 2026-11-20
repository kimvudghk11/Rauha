/** 16kHz·16bit·모노 WAV 를 Float32 소리로(확인용 실행에서 마이크 대신 넣는 소리). 형식이 다르면 null */
export function readWav16k(bytes: Buffer): Float32Array | null {
  if (bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') return null;
  let rate = 0;
  let bits = 0;
  let channels = 0;
  let off = 12;
  while (off + 8 <= bytes.length) {
    const id = bytes.toString('ascii', off, off + 4);
    const size = bytes.readUInt32LE(off + 4);
    if (id === 'fmt ') {
      channels = bytes.readUInt16LE(off + 10);
      rate = bytes.readUInt32LE(off + 12);
      bits = bytes.readUInt16LE(off + 22);
    } else if (id === 'data') {
      if (rate !== 16000 || bits !== 16 || channels !== 1) return null;
      const n = Math.floor(Math.min(size, bytes.length - off - 8) / 2);
      const out = new Float32Array(n);
      for (let i = 0; i < n; i += 1) out[i] = bytes.readInt16LE(off + 8 + i * 2) / 32768;
      return out;
    }
    off += 8 + size + (size % 2);
  }
  return null;
}
