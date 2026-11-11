import { ApiError, ApiRequest } from './api-request.js';

export const COLLECTION_LIMITS = { nodes: 2000, depth: 6, name: 120 } as const;

export type CollectionNode =
  | { readonly kind: 'folder'; readonly id: string; readonly parentId: string | null; readonly name: string }
  | { readonly kind: 'request'; readonly id: string; readonly parentId: string | null; readonly request: ApiRequest };

/** 화면용 나무 */
export type TreeItem =
  | { readonly kind: 'folder'; readonly id: string; readonly name: string; readonly children: readonly TreeItem[] }
  | { readonly kind: 'request'; readonly id: string; readonly name: string; readonly method: string };

/** 가져오기 결과: 이름 붙은 묶음(폴더)들과 환경에 넣을 변수 */
export interface ImportedCollection {
  readonly name: string;
  readonly groups: readonly { readonly name: string; readonly requests: readonly ApiRequest[] }[];
  readonly variables: readonly { readonly name: string; readonly value: string }[];
}

const cleanName = (name: string): string => {
  const n = name.trim().replace(/\s+/g, ' ');
  if (n === '') throw new ApiError('Name cannot be empty.');
  if (n.length > COLLECTION_LIMITS.name) throw new ApiError(`Name is too long (at most ${COLLECTION_LIMITS.name} characters).`);
  return n;
};

/** 컬렉션: 폴더와 요청이 섞인 나무. 모든 바꾸기는 새 컬렉션을 돌려준다. */
export class ApiCollections {
  private constructor(readonly nodes: readonly CollectionNode[]) {}

  static empty(): ApiCollections {
    return new ApiCollections([]);
  }

  static of(nodes: readonly CollectionNode[]): ApiCollections {
    if (nodes.length > COLLECTION_LIMITS.nodes) throw new ApiError(`At most ${COLLECTION_LIMITS.nodes} items fit in the collections.`);
    const ids = new Set<string>();
    for (const n of nodes) {
      if (ids.has(n.id)) throw new ApiError('Two items have the same id.');
      ids.add(n.id);
    }
    const out = new ApiCollections(nodes);
    for (const n of nodes) {
      if (n.parentId !== null) {
        const p = out.node(n.parentId);
        if (p === undefined || p.kind !== 'folder') throw new ApiError('An item points to a folder that does not exist.');
      }
      if (out.depthOf(n.id) > COLLECTION_LIMITS.depth) throw new ApiError(`Folders can be nested at most ${COLLECTION_LIMITS.depth} levels.`);
    }
    return out;
  }

  node(id: string): CollectionNode | undefined {
    return this.nodes.find((n) => n.id === id);
  }

  request(id: string): ApiRequest | undefined {
    const n = this.node(id);
    return n?.kind === 'request' ? n.request : undefined;
  }

  private depthOf(id: string): number {
    let d = 0;
    let cur = this.node(id);
    while (cur !== undefined && d <= COLLECTION_LIMITS.depth + 2) {
      d++;
      cur = cur.parentId === null ? undefined : this.node(cur.parentId);
    }
    return d;
  }

  private mustFind(id: string): CollectionNode {
    const n = this.node(id);
    if (n === undefined) throw new ApiError('That item no longer exists.');
    return n;
  }

  private siblingNames(parentId: string | null, exceptId: string | null): Set<string> {
    return new Set(this.nodes.filter((n) => n.parentId === parentId && n.id !== exceptId).map((n) => (n.kind === 'folder' ? n.name : n.request.name).toLowerCase()));
  }

  /** 같은 폴더에서 이름이 겹치면 "이름 2"처럼 번호를 붙인다 */
  private uniqueName(name: string, parentId: string | null, exceptId: string | null): string {
    const taken = this.siblingNames(parentId, exceptId);
    if (!taken.has(name.toLowerCase())) return name;
    for (let i = 2; ; i++) {
      const candidate = `${name} ${i}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
  }

  addFolder(id: string, name: string, parentId: string | null): ApiCollections {
    return ApiCollections.of([...this.nodes, { kind: 'folder', id, parentId, name: this.uniqueName(cleanName(name), parentId, null) }]);
  }

  addRequest(request: ApiRequest, parentId: string | null): ApiCollections {
    const named = request.withName(this.uniqueName(cleanName(request.name), parentId, null));
    return ApiCollections.of([...this.nodes, { kind: 'request', id: named.id, parentId, request: named }]);
  }

  /** 요청 내용을 저장한다(이름은 요청이 가진 그대로) */
  updateRequest(request: ApiRequest): ApiCollections {
    const cur = this.mustFind(request.id);
    if (cur.kind !== 'request') throw new ApiError('That item is a folder.');
    const named = request.withName(this.uniqueName(cleanName(request.name), cur.parentId, cur.id));
    return ApiCollections.of(this.nodes.map((n) => (n.id === cur.id ? { kind: 'request', id: n.id, parentId: n.parentId, request: named } : n)));
  }

  rename(id: string, name: string): ApiCollections {
    const cur = this.mustFind(id);
    const unique = this.uniqueName(cleanName(name), cur.parentId, id);
    return ApiCollections.of(this.nodes.map((n) => (n.id !== id ? n : n.kind === 'folder' ? { ...n, name: unique } : { ...n, request: n.request.withName(unique) })));
  }

  /** 복제(폴더는 안의 것까지). 새 번호는 newId()로 받는다. 같은 폴더에 "이름 2"로 놓는다. */
  duplicate(id: string, newId: () => string): ApiCollections {
    const root = this.mustFind(id);
    const add: CollectionNode[] = [];
    const copy = (n: CollectionNode, parentId: string | null, top: boolean): void => {
      const nid = newId();
      if (n.kind === 'request') {
        const name = top ? this.uniqueName(n.request.name, parentId, null) : n.request.name;
        add.push({ kind: 'request', id: nid, parentId, request: n.request.withId(nid).withName(name) });
        return;
      }
      add.push({ kind: 'folder', id: nid, parentId, name: top ? this.uniqueName(n.name, parentId, null) : n.name });
      for (const c of this.nodes.filter((x) => x.parentId === n.id)) copy(c, nid, false);
    };
    copy(root, root.parentId, true);
    return ApiCollections.of([...this.nodes, ...add]);
  }

  /** 지우기(폴더는 안의 것까지) */
  remove(id: string): ApiCollections {
    this.mustFind(id);
    const gone = new Set<string>([id]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const n of this.nodes) if (n.parentId !== null && gone.has(n.parentId) && !gone.has(n.id)) (gone.add(n.id), (grew = true));
    }
    return new ApiCollections(this.nodes.filter((n) => !gone.has(n.id)));
  }

  /** 다른 폴더(또는 맨 위 null)로 옮긴다. 자기 안으로는 옮길 수 없다. */
  move(id: string, parentId: string | null): ApiCollections {
    const cur = this.mustFind(id);
    if (parentId !== null) {
      for (let p: CollectionNode | undefined = this.node(parentId); p !== undefined; p = p.parentId === null ? undefined : this.node(p.parentId)) {
        if (p.id === id) throw new ApiError('A folder cannot move into itself.');
      }
    }
    const name = cur.kind === 'folder' ? cur.name : cur.request.name;
    const unique = this.uniqueName(name, parentId, id);
    return ApiCollections.of(this.nodes.map((n) => (n.id !== id ? n : n.kind === 'folder' ? { ...n, parentId, name: unique } : { ...n, parentId, request: n.request.withName(unique) })));
  }

  /** 가져온 묶음들을 새 폴더(가져온 이름)로 더한다. 묶음이 하나뿐이면 폴더 한 겹만 만든다. */
  addImport(imp: ImportedCollection, newId: () => string): ApiCollections {
    let next = this.addFolder(newId(), imp.name, null);
    const rootId = (next.nodes[next.nodes.length - 1] as CollectionNode).id;
    for (const g of imp.groups) {
      let parent = rootId;
      if (imp.groups.length > 1 || g.name !== '') {
        const fid = newId();
        next = next.addFolder(fid, g.name === '' ? 'General' : g.name, rootId);
        parent = fid;
      }
      for (const r of g.requests) next = next.addRequest(r.withId(newId()), parent);
    }
    return next;
  }

  /** 모든 요청(나무 순서대로) */
  requests(): ApiRequest[] {
    return this.tree().flatMap(function flat(t): string[] {
      return t.kind === 'request' ? [t.id] : t.children.flatMap(flat);
    }).map((id) => this.request(id) as ApiRequest);
  }

  /** 폴더가 먼저, 이름순 */
  tree(parentId: string | null = null): TreeItem[] {
    const kids = this.nodes.filter((n) => n.parentId === parentId);
    const label = (n: CollectionNode): string => (n.kind === 'folder' ? n.name : n.request.name);
    const sorted = [...kids].sort((a, b) => (a.kind === b.kind ? label(a).localeCompare(label(b)) : a.kind === 'folder' ? -1 : 1));
    return sorted.map((n): TreeItem => (n.kind === 'folder' ? { kind: 'folder', id: n.id, name: n.name, children: this.tree(n.id) } : { kind: 'request', id: n.id, name: n.request.name, method: n.request.props.method }));
  }
}
