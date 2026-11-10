import { ChatHistoryDto } from '../../shared/chat-history-dto.js';
import { ChatHistory } from '../../shared/chat-history.js';
import { JsonFile } from './json-file.js';

/** 채팅 말풍선 기록을 앱 데이터 폴더의 JSON 파일 하나에 둔다. */
export interface ChatHistoryStorePort {
  load(): Promise<ChatHistory>;
  save(history: ChatHistory): Promise<void>;
}

export class ChatHistoryStore implements ChatHistoryStorePort {
  private readonly json: JsonFile;
  constructor(file: string, private readonly now: () => string = () => new Date().toISOString()) {
    this.json = new JsonFile(file);
  }

  /** 없으면 빈 기록. 깨진 파일은 `.bak-<시각>`으로 보존하고 빈 기록으로 시작한다. 일부 항목만 깨졌으면 원본을 보존하고 읽을 수 있는 만큼 연다. */
  async load(): Promise<ChatHistory> {
    const read = await this.json.read();
    if (read.kind === 'missing') return ChatHistory.empty();
    if (read.kind === 'broken') {
      await this.json.keepCopy(this.now(), 'bak');
      return ChatHistory.empty();
    }
    const dto = ChatHistoryDto.from(read.value);
    if (dto.skipped > 0) await this.json.keepCopy(this.now(), 'bak');
    return dto.toEntity();
  }

  async save(history: ChatHistory): Promise<void> {
    await this.json.write(ChatHistoryDto.fromEntity(history));
  }
}
