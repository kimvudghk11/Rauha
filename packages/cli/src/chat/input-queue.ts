export interface InputQueueHost {
  enqueue(text: string): void;
  dequeue(): string | undefined;
  print(line: string): void;
  saveHistory(text: string): void;
  /** 쌓아 둔 입력을 다루는 명령인지 */
  isQueueCommand(text: string): boolean;
  queueCommand(text: string): void;
  /** 입력 하나를 처음부터 끝까지 처리한다 */
  handle(text: string): Promise<void>;
}

export interface InputQueue {
  submit(text: string): void;
  running(): boolean;
}

/** 일하는 중에 받은 입력은 대기열에 세우고, 지금 일이 끝나면 넣은 순서대로 하나씩 처리한다. */
export function createInputQueue(host: InputQueueHost): InputQueue {
  let running = false;
  const drain = async (first: string): Promise<void> => {
    running = true;
    try {
      for (let next: string | undefined = first; next !== undefined; next = host.dequeue()) await host.handle(next).catch((error: Error) => host.print(`rauha: ${error.message}`));
    } finally {
      running = false;
    }
  };
  return {
    running: () => running,
    submit(text) {
      host.saveHistory(text);
      // 쌓아 둔 입력을 다루는 명령은 줄 서지 않고 바로 처리한다.
      if (host.isQueueCommand(text)) return host.queueCommand(text);
      if (running) return host.enqueue(text);
      void drain(text);
    },
  };
}
