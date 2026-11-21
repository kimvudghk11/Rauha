/** 받아쓰기에 넘길 가장 짧은 소리(16kHz 에서 0.1초) */
export const MIN_ASR_SAMPLES = 1600;

/**
 * 받아쓰기 엔진(Whisper, onnxruntime)에 넘길 소리. 큰 배열의 중간을 가리키는 창(subarray)이나 IPC 로 받은 배열을
 * 그대로 넘기면 엔진이 뒤의 원래 메모리 크기로 계산해 "invalid buffer size" 로 실패할 수 있어서, 늘 처음부터 시작하는 새 배열로 복사한다.
 * 너무 짧은 조각은 받아쓸 것이 없으니 null. 숫자가 아닌 값은 0 으로 바꾼다.
 */
export function audioForAsr(samples: Float32Array): Float32Array | null {
  if (samples.length < MIN_ASR_SAMPLES) return null;
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    const v = samples[i]!;
    out[i] = Number.isFinite(v) ? v : 0;
  }
  return out;
}
