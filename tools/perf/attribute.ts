// Attributes Chrome sampling-heap-profiler samples to the code that made each allocation.

export interface CallFrame {
  readonly functionName: string;
  readonly url: string;
  readonly lineNumber: number;
  readonly columnNumber: number;
}

export interface ProfileNode {
  readonly id: number;
  readonly callFrame: CallFrame;
  readonly selfSize: number;
  readonly children: readonly ProfileNode[];
}

export interface SamplingProfile {
  readonly head: ProfileNode;
  readonly samples: readonly { readonly size: number; readonly nodeId: number }[];
}

export type Owner = 'ours' | 'three' | 'other';

export interface Bucket {
  bytes: number;
  samples: number;
  sites: { site: string; bytes: number }[];
}

export interface Attribution {
  /** Allocations whose stack passes through the render loop's `frame` in src/main.ts. */
  readonly frameLoop: Record<Owner, Bucket> & { bytes: number };
  /** Everything else: startup, event handlers, the overlay's timers. */
  readonly outside: { bytes: number };
}

const isOurs = (url: string): boolean => url.includes('/src/');
const isThree = (url: string): boolean => url.includes('/node_modules/') || url.includes('three');

/** The innermost JavaScript frame decides the owner; native built-ins inherit their caller. */
export function ownerOf(stack: readonly CallFrame[]): { owner: Owner; site: string } {
  for (let i = stack.length - 1; i >= 0; i--) {
    const frame = stack[i];
    if (frame === undefined || frame.url === '') continue;
    const site = `${frame.functionName || '(anonymous)'} ${frame.url.replace(/^.*?\/(src|node_modules)\//, '$1/')}:${frame.lineNumber + 1}`;
    if (isOurs(frame.url)) return { owner: 'ours', site };
    if (isThree(frame.url)) return { owner: 'three', site };
    return { owner: 'other', site };
  }
  return { owner: 'other', site: '(native)' };
}

const inFrameLoop = (stack: readonly CallFrame[]): boolean =>
  stack.some((f) => f.functionName === 'frame' && f.url.includes('/src/main.ts'));

export function attribute(profile: SamplingProfile): Attribution {
  const stacks = new Map<number, CallFrame[]>();
  const walk = (node: ProfileNode, parent: CallFrame[]): void => {
    const stack = [...parent, node.callFrame];
    stacks.set(node.id, stack);
    for (const child of node.children) walk(child, stack);
  };
  walk(profile.head, []);

  const empty = (): Bucket => ({ bytes: 0, samples: 0, sites: [] });
  const frameLoop = { ours: empty(), three: empty(), other: empty(), bytes: 0 };
  const outside = { bytes: 0 };
  const siteBytes: Record<Owner, Map<string, number>> = {
    ours: new Map(),
    three: new Map(),
    other: new Map(),
  };

  for (const sample of profile.samples) {
    const stack = stacks.get(sample.nodeId) ?? [];
    if (!inFrameLoop(stack)) {
      outside.bytes += sample.size;
      continue;
    }
    const { owner, site } = ownerOf(stack);
    frameLoop[owner].bytes += sample.size;
    frameLoop[owner].samples++;
    frameLoop.bytes += sample.size;
    siteBytes[owner].set(site, (siteBytes[owner].get(site) ?? 0) + sample.size);
  }
  for (const owner of ['ours', 'three', 'other'] as const) {
    frameLoop[owner].sites = [...siteBytes[owner]]
      .map(([site, bytes]) => ({ site, bytes }))
      .sort((a, b) => b.bytes - a.bytes);
  }
  return { frameLoop, outside };
}

/**
 * Adds up attributions of consecutive profiles. Long runs are sampled in chunks because one
 * profile of a heavily allocating page can outgrow the largest string Node can parse.
 */
export function mergeAttributions(parts: readonly Attribution[]): Attribution {
  const owners = ['ours', 'three', 'other'] as const;
  const siteBytes: Record<Owner, Map<string, number>> = {
    ours: new Map(),
    three: new Map(),
    other: new Map(),
  };
  const empty = (): Bucket => ({ bytes: 0, samples: 0, sites: [] });
  const frameLoop = { ours: empty(), three: empty(), other: empty(), bytes: 0 };
  const outside = { bytes: 0 };
  for (const part of parts) {
    frameLoop.bytes += part.frameLoop.bytes;
    outside.bytes += part.outside.bytes;
    for (const owner of owners) {
      frameLoop[owner].bytes += part.frameLoop[owner].bytes;
      frameLoop[owner].samples += part.frameLoop[owner].samples;
      for (const { site, bytes } of part.frameLoop[owner].sites) {
        siteBytes[owner].set(site, (siteBytes[owner].get(site) ?? 0) + bytes);
      }
    }
  }
  for (const owner of owners) {
    frameLoop[owner].sites = [...siteBytes[owner]]
      .map(([site, bytes]) => ({ site, bytes }))
      .sort((a, b) => b.bytes - a.bytes);
  }
  return { frameLoop, outside };
}
