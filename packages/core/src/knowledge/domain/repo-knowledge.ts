import type { RepoRef } from './repo-ref.js';

/** 코드가 계산하는 저장소 사실(모델 호출 없음). dirs는 영역(깊이 1~2 폴더, 루트는 '.')별 파일 수. */
export interface RepoFacts {
  readonly totalFiles: number;
  readonly dirs: readonly { readonly path: string; readonly files: number }[];
  readonly packageManager: string | null;
  readonly scripts: Readonly<Record<string, string>>;
  readonly instructionFiles: readonly string[];
  readonly testPattern: string | null;
}

/** 영역 하나의 짧은 메모와 그 근거가 된 파일 */
export interface AreaNote {
  readonly area: string;
  readonly text: string;
  readonly sources: readonly string[];
}

/** 바뀐 파일이 이만큼이면 고치지 않고 처음부터 다시 만든다(스펙 3.3-6). */
const REBUILD_FILES = 200;
const REBUILD_RATIO = 0.3;

function present(hashes: ReadonlyMap<string, string | null> | undefined): Map<string, string> {
  return new Map([...(hashes ?? [])].filter((e): e is [string, string] => e[1] !== null));
}

/** 파일이 속한 영역: 폴더 앞 두 단계. 루트 파일은 '.'. */
export function areaOf(path: string): string {
  const dirs = path.split('/').slice(0, -1);
  return dirs.length === 0 ? '.' : dirs.slice(0, 2).join('/');
}

/**
 * 저장소 지식. 언제나 기준(RepoRef)이 붙고, 바뀐 파일을 받으면 그 파일을 근거로 쓴 메모와
 * 메모 없는 새 영역을 낡음으로 표시한다. 메모를 다시 쓰는 일(모델 호출)은 서비스가 맡는다.
 */
export class RepoKnowledge {
  private constructor(
    private ref: RepoRef,
    private currentFacts: RepoFacts,
    private readonly symbolMap: Map<string, readonly string[]>,
    private readonly fileSet: Set<string>,
    private readonly noteMap: Map<string, AreaNote>,
    private readonly staleSet: Set<string>,
    /** 파일 → 지식에 반영한 내용 해시. 같은 내용이 다시 "바뀜"으로 보고돼도 낡음으로 치지 않으려고. */
    private readonly hashMap: Map<string, string>,
  ) {}

  /** files: 지식이 아는 파일 전체(메모 근거 검증용). 없으면 심볼 지도의 파일만. hashes: 파일 내용 해시. */
  static create(p: { basis: RepoRef; facts: RepoFacts; symbols: ReadonlyMap<string, readonly string[]>; files?: readonly string[]; hashes?: ReadonlyMap<string, string | null> }): RepoKnowledge {
    return new RepoKnowledge(p.basis, p.facts, new Map(p.symbols), new Set(p.files ?? p.symbols.keys()), new Map(), new Set(), present(p.hashes));
  }

  /** 저장해 둔 지식을 되살린다(DTO가 쓴다). */
  static restore(p: {
    basis: RepoRef;
    facts: RepoFacts;
    symbols: ReadonlyMap<string, readonly string[]>;
    files: readonly string[];
    notes: readonly AreaNote[];
    stale: readonly string[];
    hashes: ReadonlyMap<string, string>;
  }): RepoKnowledge {
    return new RepoKnowledge(p.basis, p.facts, new Map(p.symbols), new Set(p.files), new Map(p.notes.map((n) => [n.area, n])), new Set(p.stale), new Map(p.hashes));
  }

  get hashes(): ReadonlyMap<string, string> {
    return this.hashMap;
  }

  /** 보고된 파일 중 지식에 반영한 내용과 실제로 다른 것(지워졌거나 처음 보는 파일 포함). */
  changedFiles(hashes: ReadonlyMap<string, string | null>): string[] {
    return [...hashes].filter(([path, hash]) => hash === null || this.hashMap.get(path) !== hash).map(([path]) => path).sort();
  }

  get basis(): RepoRef {
    return this.ref;
  }

  get facts(): RepoFacts {
    return this.currentFacts;
  }

  get symbols(): ReadonlyMap<string, readonly string[]> {
    return this.symbolMap;
  }

  get files(): readonly string[] {
    return [...this.fileSet].sort();
  }

  get notes(): readonly AreaNote[] {
    return [...this.noteMap.values()];
  }

  get stale(): readonly string[] {
    return [...this.staleSet].sort();
  }

  areas(): string[] {
    return this.currentFacts.dirs.filter((d) => d.files > 0).map((d) => d.path);
  }

  needsRebuild(changedCount: number): boolean {
    return changedCount >= REBUILD_FILES || changedCount >= this.currentFacts.totalFiles * REBUILD_RATIO;
  }

  /** changed: 바뀐 파일 → 새 심볼(지워진 파일은 null). 파일이 생기거나 지워진 영역을 낡음으로 표시하고 기준을 바꾼다. */
  applyChanges(p: { basis: RepoRef; facts: RepoFacts; changed: ReadonlyMap<string, readonly string[] | null>; hashes?: ReadonlyMap<string, string | null> }): void {
    for (const [path, hash] of p.hashes ?? []) {
      if (hash === null) this.hashMap.delete(path);
      else this.hashMap.set(path, hash);
    }
    for (const [path, symbols] of p.changed) {
      // 메모는 영역의 역할과 관례라서, 있던 파일의 내용이 바뀐 정도로는 낡지 않는다(내보낸 이름은 심볼 지도가 따라간다).
      // 파일이 새로 생기거나 지워져 영역의 모양이 바뀔 때만 다시 조사한다.
      const known = this.fileSet.has(path);
      if (symbols === null) {
        this.symbolMap.delete(path);
        this.fileSet.delete(path);
        if (known) this.staleSet.add(areaOf(path));
      } else {
        if (symbols.length > 0) this.symbolMap.set(path, symbols);
        else this.symbolMap.delete(path);
        this.fileSet.add(path);
        if (!known) this.staleSet.add(areaOf(path));
      }
    }
    this.ref = p.basis;
    this.currentFacts = p.facts;
    const areas = new Set(this.areas());
    for (const area of [...this.noteMap.keys()]) if (!areas.has(area)) this.noteMap.delete(area);
  }

  /** 메모가 없거나 낡은 영역 */
  staleAreas(): string[] {
    return this.areas().filter((a) => !this.noteMap.has(a) || this.staleSet.has(a));
  }

  /** 같은 영역의 메모를 바꾸고 낡음 표시를 지운다. 근거 중 지식에 없는 파일(지어낸 경로)은 버린다. */
  writeNotes(notes: readonly AreaNote[]): void {
    for (const note of notes) {
      this.noteMap.set(note.area, { area: note.area, text: note.text, sources: note.sources.filter((s) => this.fileSet.has(s)) });
      this.staleSet.delete(note.area);
    }
  }

  /**
   * 업무 범위가 걸친 영역의 메모(그 영역의 역할과 관례)만 묶는다. 테스트·구현·리뷰 팀원이 그 저장소 방식대로 쓰게 한다.
   * 범위의 파일·glob이 속한 영역(앞 두 단계 폴더)만 고르고, 메모가 없으면 빈 글. maxChars를 넘으면 뒤의 메모부터 뺀다.
   */
  areaNotesFor(paths: readonly string[], maxChars = 1_500): string {
    const areas = new Set(paths.map((p) => areaOf(p.replace(/\\/g, '/').replace(/^\.\//, ''))));
    const notes = this.notes.filter((n) => areas.has(n.area)).map((n) => `- ${n.area}: ${n.text}`);
    const open = '<area_notes>\n일할 곳의 역할과 관례입니다(저장소 조사 메모). 새 코드는 이 관례를 따르세요.';
    const close = '</area_notes>';
    const lines: string[] = [];
    for (const line of notes) {
      if ([open, ...lines, line, close].join('\n').length > maxChars) break;
      lines.push(line);
    }
    return lines.length === 0 ? '' : [open, ...lines, close].join('\n');
  }

  /**
   * 팀원 메시지 맨 앞에 넣을 묶음. 팀원에게는 구조·명령·메모만 준다: 묶음은 팀원의 턴마다 다시 보내지므로
   * 파일마다 이름을 늘어놓은 심볼 지도까지 넣으면 아낀 턴보다 토큰이 더 든다(2026-10-27 측정).
   * withSymbols: 조사 팀원처럼 파일을 골라야 하는 쪽에만. maxChars를 넘으면 심볼 지도, 그다음 메모를 뒤에서부터 뺀다.
   */
  toBlock(repoName: string, maxChars = 12_000, withSymbols = false): string {
    const f = this.currentFacts;
    const open = `<repo_knowledge repo="${repoName}" basis="${this.ref.label()}">`;
    const close = '</repo_knowledge>';
    const head = [
      open,
      '기준 커밋의 저장소 요약입니다. 구조를 파악하는 데 먼저 쓰고, 코드 내용을 근거로 쓰기 전에는 실제 파일을 여세요.',
      `영역(파일 수): ${f.dirs.map((d) => `${d.path} ${d.files}`).join(', ')} · 전체 ${f.totalFiles}개`,
      `패키지 관리자: ${f.packageManager ?? '없음'} · 스크립트: ${Object.entries(f.scripts).map(([k, v]) => `${k}=${v}`).join(', ') || '없음'}`,
      `지시 파일: ${f.instructionFiles.join(', ') || '없음'} · 테스트 파일: ${f.testPattern ?? '없음'}`,
    ];
    const notes = this.notes.map((n) => `- ${n.area}: ${n.text}${n.sources.length > 0 ? ` (근거: ${n.sources.join(', ')})` : ''}`);
    const symbols = [...this.symbolMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([path, names]) => `${path}: ${names.join(', ')}`);
    const size = (lines: readonly string[]) => lines.join('\n').length + 1 + close.length;

    const lines = [...head, ...(notes.length > 0 ? ['영역 메모:', ...notes] : [])];
    while (size(lines) > maxChars && lines.length > head.length) lines.pop();
    if (withSymbols && symbols.length > 0 && size([...lines, '심볼:', symbols[0]!]) <= maxChars) {
      lines.push('심볼:');
      for (const line of symbols) {
        if (size([...lines, line]) > maxChars) break;
        lines.push(line);
      }
    }
    return [...lines, close].join('\n');
  }
}
