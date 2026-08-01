/**
 * StrictMode-контракт эффектов.
 *
 * `src/main.tsx` оборачивает приложение в `React.StrictMode`, то есть в dev
 * React монтирует каждый компонент дважды: setup -> cleanup -> setup. Ни один
 * существующий тест под StrictMode не рендерил, поэтому идемпотентность
 * эффектов не была защищена — а именно её ломают обновления React.
 *
 * Проверяется на useOnlineStatus: он вешает слушатели на window, поэтому
 * утечка наблюдаема напрямую по числу подписок.
 */

import { StrictMode } from 'react';
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { useOnlineStatus, ONLINE_EVENT } from '../useOnlineStatus';

describe('useOnlineStatus под StrictMode', () => {
  let added: Record<string, number>;
  let removed: Record<string, number>;
  let addSpy: MockInstance;
  let removeSpy: MockInstance;

  beforeEach(() => {
    added = {};
    removed = {};
    const realAdd = window.addEventListener.bind(window);
    const realRemove = window.removeEventListener.bind(window);

    addSpy = vi
      .spyOn(window, 'addEventListener')
      .mockImplementation((type: string, ...rest: unknown[]) => {
        added[type] = (added[type] ?? 0) + 1;
        return (realAdd as (...a: unknown[]) => void)(type, ...rest);
      });
    removeSpy = vi
      .spyOn(window, 'removeEventListener')
      .mockImplementation((type: string, ...rest: unknown[]) => {
        removed[type] = (removed[type] ?? 0) + 1;
        return (realRemove as (...a: unknown[]) => void)(type, ...rest);
      });
  });

  afterEach(() => {
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it('после размонтирования снимает ровно столько слушателей, сколько повесил', () => {
    const { unmount } = renderHook(() => useOnlineStatus(), {
      wrapper: StrictMode,
    });

    // StrictMode обязан выполнить двойной монтаж: setup -> cleanup -> setup.
    // Если этого нет, тест перестанет защищать заявленный контракт.
    expect(added.online).toBeGreaterThanOrEqual(2);
    expect(removed.online).toBeGreaterThanOrEqual(1);

    unmount();

    expect(removed.online).toBe(added.online);
    expect(removed.offline).toBe(added.offline);
  });

  it('не дублирует реакцию на событие online после двойного монтажа', () => {
    const seen: number[] = [];
    const listener = () => seen.push(Date.now());
    window.addEventListener(ONLINE_EVENT, listener);

    const { result, unmount } = renderHook(() => useOnlineStatus(), {
      wrapper: StrictMode,
    });

    act(() => {
      window.dispatchEvent(new Event('online'));
    });

    // Живой слушатель ровно один, несмотря на два прогона setup.
    expect(seen).toHaveLength(1);
    expect(result.current.isOnline).toBe(true);
    expect(result.current.lastOnlineAt).not.toBeNull();

    window.removeEventListener(ONLINE_EVENT, listener);
    unmount();
  });
});
