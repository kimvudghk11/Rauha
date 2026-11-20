/**
 * 이 PC 안에서만 도는 받아쓰기(Whisper, transformers.js + onnxruntime-node). 소리는 밖으로 나가지 않는다.
 * 모델은 처음 한 번 Hugging Face 에서 내려받아 cacheDir 에 둔다(whisper-small 약 250MB).
 * 한 번에 하나씩 받아쓴다(여러 개가 겹쳐 CPU 를 다 쓰지 않게).
 */
type Asr = (audio: Float32Array, options: Record<string, unknown>) => Promise<{ text: string } | { text: string }[]>;

export type TranscriberState = 'idle' | 'loading' | 'ready' | 'failed';

export const DEFAULT_ASR_MODEL = 'onnx-community/whisper-small';

export class LocalTranscriber {
  private loading: Promise<Asr> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private current: TranscriberState = 'idle';

  constructor(
    private readonly cacheDir: string,
    private readonly onState: (state: TranscriberState, detail?: string) => void,
    private readonly model = process.env['RAUHA_ASR_MODEL'] ?? DEFAULT_ASR_MODEL,
  ) {}

  private pending = 0;

  get state(): TranscriberState {
    return this.current;
  }

  /** 받아쓰는 중이거나 기다리는 것이 있는지 */
  get busy(): boolean {
    return this.pending > 0;
  }

  /** 미리 모델을 올려 둔다(처음 부를 때 오래 기다리지 않게) */
  warm(): Promise<void> {
    return this.load().then(
      () => undefined,
      () => undefined,
    );
  }

  /** 16kHz 소리를 한국어 글로 */
  transcribe(samples: Float32Array): Promise<string> {
    this.pending += 1;
    const run = this.queue.then(async () => {
      const asr = await this.load();
      const out = await asr(samples, { language: 'korean', task: 'transcribe' });
      return (Array.isArray(out) ? out.map((o) => o.text).join(' ') : out.text).trim();
    });
    const settled = run.then(
      () => undefined,
      () => undefined,
    );
    void settled.then(() => (this.pending -= 1));
    this.queue = settled;
    return run;
  }

  private load(): Promise<Asr> {
    if (this.loading !== null) return this.loading;
    this.set('loading');
    this.loading = (async () => {
      const t = await import('@huggingface/transformers');
      t.env.cacheDir = this.cacheDir;
      t.env.allowLocalModels = false;
      const asr = (await t.pipeline('automatic-speech-recognition', this.model, { dtype: 'q8', device: 'cpu' })) as unknown as Asr;
      this.set('ready');
      return asr;
    })();
    this.loading.catch((error: unknown) => {
      this.loading = null;
      this.set('failed', error instanceof Error ? error.message : String(error));
    });
    return this.loading;
  }

  private set(state: TranscriberState, detail?: string): void {
    this.current = state;
    this.onState(state, detail);
  }
}
