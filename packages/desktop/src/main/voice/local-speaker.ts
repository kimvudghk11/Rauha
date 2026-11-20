import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * 이 PC 안에서만 도는 말하기(Supertonic 2, 슈퍼톤 공개 모델, transformers.js). 글은 밖으로 나가지 않는다.
 * 모델(약 250MB)과 목소리 파일은 처음 한 번 Hugging Face 에서 내려받아 cacheDir 에 둔다. 한 번에 하나씩 만든다.
 */
type Tts = (text: string, options: Record<string, unknown>) => Promise<{ audio: Float32Array; sampling_rate: number }>;

export const TTS_MODEL = 'onnx-community/Supertonic-TTS-2-ONNX';

export interface SpokenAudio {
  readonly audio: Float32Array;
  readonly rate: number;
}

export class LocalSpeaker {
  private loading: Promise<Tts> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly voices = new Map<string, Float32Array>();

  constructor(
    private readonly cacheDir: string,
    private readonly log: (text: string) => void,
  ) {}

  /** 미리 모델을 올려 둔다(처음 말할 때 오래 기다리지 않게) */
  warm(): Promise<void> {
    return this.load().then(
      () => undefined,
      () => undefined,
    );
  }

  /** 한국어 글을 소리로. voice 는 모델의 목소리 이름(M3·F5 …) */
  speak(text: string, voice: string): Promise<SpokenAudio> {
    const run = this.queue.then(async () => {
      const [tts, style] = await Promise.all([this.load(), this.voice(voice)]);
      const out = await tts(`<ko>${text}</ko>`, { speaker_embeddings: style, num_inference_steps: 5, speed: 1.05 });
      return { audio: out.audio, rate: out.sampling_rate };
    });
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private load(): Promise<Tts> {
    if (this.loading !== null) return this.loading;
    this.loading = (async () => {
      const t = await import('@huggingface/transformers');
      t.env.cacheDir = this.cacheDir;
      t.env.allowLocalModels = false;
      return (await t.pipeline('text-to-speech', TTS_MODEL, { device: 'cpu' })) as unknown as Tts;
    })();
    this.loading.catch((error: unknown) => {
      this.loading = null;
      this.log(`말하기 모델을 못 올림: ${error instanceof Error ? error.message : String(error)}`);
    });
    return this.loading;
  }

  /** 목소리 파일: 한 번 내려받아 두고 다시 쓴다 */
  private async voice(name: string): Promise<Float32Array> {
    const kept = this.voices.get(name);
    if (kept !== undefined) return kept;
    if (!/^[FM]\d$/.test(name)) throw new Error(`모르는 목소리: ${name}`);
    const file = join(this.cacheDir, 'supertonic-voices', `${name}.bin`);
    let bytes = await readFile(file).catch(() => null);
    if (bytes === null) {
      const res = await fetch(`https://huggingface.co/${TTS_MODEL}/resolve/main/voices/${name}.bin`);
      if (!res.ok) throw new Error(`목소리 파일을 못 받음: ${res.status}`);
      bytes = Buffer.from(await res.arrayBuffer());
      await mkdir(join(this.cacheDir, 'supertonic-voices'), { recursive: true });
      await writeFile(file, bytes);
    }
    const style = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    this.voices.set(name, style);
    return style;
  }
}
