import { API_BASE } from '../config';
import type { Color, Difficulty, GameStateResponse } from '../types';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function createGame(color: Color, difficulty: Difficulty): Promise<GameStateResponse> {
  return request('/games', { method: 'POST', body: JSON.stringify({ color, difficulty }) });
}

export function submitMove(
  gameId: string,
  from: string,
  to: string,
  promotion?: string,
): Promise<GameStateResponse> {
  return request(`/games/${gameId}/move`, {
    method: 'POST',
    body: JSON.stringify({ from, to, promotion }),
  });
}

export function resignGame(gameId: string): Promise<GameStateResponse> {
  return request(`/games/${gameId}/resign`, { method: 'POST' });
}

export function fetchGame(gameId: string): Promise<GameStateResponse> {
  return request(`/games/${gameId}`);
}
