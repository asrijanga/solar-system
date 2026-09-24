import { describe, expect, it } from 'vitest';
import { attribute, ownerOf, type CallFrame, type ProfileNode } from './attribute.ts';

const cf = (functionName: string, url: string, lineNumber = 0): CallFrame => ({
  functionName,
  url,
  lineNumber,
  columnNumber: 0,
});

const MAIN = 'http://localhost:5173/src/main.ts';
const THREE = 'http://localhost:5173/node_modules/.vite/deps/three_webgpu.js?v=1';

describe('ownerOf', () => {
  it('attributes to the innermost JavaScript frame', () => {
    const stack = [cf('(root)', ''), cf('frame', MAIN), cf('render', THREE, 99)];
    expect(ownerOf(stack)).toEqual({
      owner: 'three',
      site: 'render node_modules/.vite/deps/three_webgpu.js?v=1:100',
    });
  });

  it('skips native frames, which have no URL, and blames their caller', () => {
    const stack = [cf('(root)', ''), cf('frame', MAIN, 155), cf('push', '')];
    expect(ownerOf(stack).owner).toBe('ours');
  });
});

describe('attribute', () => {
  let nextId = 1;
  const node = (callFrame: CallFrame, children: ProfileNode[] = []): ProfileNode => ({
    id: nextId++,
    callFrame,
    selfSize: 0,
    children,
  });

  it('counts only allocations under the render loop, split by owner', () => {
    const three = node(cf('render', THREE));
    const loop = node(cf('frame', MAIN), [three]);
    const startup = node(cf('start', MAIN));
    const head = node(cf('(root)', ''), [loop, startup]);
    const result = attribute({
      head,
      samples: [
        { size: 100, nodeId: three.id },
        { size: 32, nodeId: loop.id },
        { size: 5000, nodeId: startup.id },
      ],
    });
    expect(result.frameLoop.three.bytes).toBe(100);
    expect(result.frameLoop.ours.bytes).toBe(32);
    expect(result.frameLoop.bytes).toBe(132);
    expect(result.outside.bytes).toBe(5000);
  });
});
