import type { Difficulty } from '../types';
import type { EngineWorkerRequest, EngineWorkerResponse } from './worker';

export interface EngineMoveResult {
  from: string;
  to: string;
  promotion?: string;
  thinkMs: number;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, (result: EngineMoveResult) => void>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<EngineWorkerResponse>) => {
      const resolve = pending.get(event.data.id);
      if (!resolve) return;
      pending.delete(event.data.id);
      resolve(event.data);
    };
  }
  return worker;
}

/** Asks the engine (running off the main thread, so the UI never stutters) for its
 * next move from a given position. */
export function requestEngineMove(fen: string, difficulty: Difficulty): Promise<EngineMoveResult> {
  const id = nextId++;
  const request: EngineWorkerRequest = { id, fen, difficulty };
  return new Promise((resolve) => {
    pending.set(id, resolve);
    getWorker().postMessage(request);
  });
}
