import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useKeyboardNavigation } from '../useKeyboardNavigation';

/**
 * Escape как раскрытие панелей читалки.
 *
 * Это единственный путь к панелям в движках WebKit: epub.js рисует книгу
 * в iframe с `sandbox="allow-same-origin"` без `allow-scripts`, а WebKit
 * не доставляет в такой документ ни одного события, поэтому центральный
 * тап, живущий на документе iframe, там не срабатывает никогда. Слушатель
 * же висит на родительском `window`, куда sandbox не достаёт.
 */
describe('useKeyboardNavigation — Escape переключает панели', () => {
  const press = (key: string) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true }));
  };

  // Израсходованное нажатие. Это второй, независимый от флага рубеж:
  // слушатель читалки висит на `window`, то есть последним, а React флашит
  // discrete-события синхронно — оверлей успевает закрыться и сбросить своё
  // состояние ДО нас, и флаг `escapeHandledByOverlay` к этому моменту уже
  // «пустой». Поймано только e2e (`reader.spec.ts`, «should show selection
  // menu on text selection»): юнит-тесты подменяют настоящий `SelectionMenu`.
  it('израсходованное нажатие читалка не трогает, даже без флага', () => {
    const onToggleUI = vi.fn();
    const onNext = vi.fn();
    renderHook(() =>
      useKeyboardNavigation({ onNext, onPrev: vi.fn(), onToggleUI })
    );

    const consumed = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    consumed.preventDefault();
    window.dispatchEvent(consumed);
    expect(onToggleUI).not.toHaveBeenCalled();

    // То же и для листания: чужой обработчик забрал нажатие себе.
    const consumedArrow = new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true });
    consumedArrow.preventDefault();
    window.dispatchEvent(consumedArrow);
    expect(onNext).not.toHaveBeenCalled();
  });

  it('Escape вызывает onToggleUI, когда панелей нет', () => {
    const onToggleUI = vi.fn();
    renderHook(() =>
      useKeyboardNavigation({ onNext: vi.fn(), onPrev: vi.fn(), onToggleUI })
    );

    press('Escape');

    expect(onToggleUI).toHaveBeenCalledTimes(1);
  });

  it('Escape молчит при открытой панели: её закрывает сама панель', () => {
    const onToggleUI = vi.fn();
    renderHook(() =>
      useKeyboardNavigation({
        onNext: vi.fn(),
        onPrev: vi.fn(),
        onToggleUI,
        escapeHandledByOverlay: true,
      })
    );

    press('Escape');

    expect(onToggleUI).not.toHaveBeenCalled();
  });

  // Меню выделения панелью НЕ является, но слушатель Escape на `document`
  // у него свой (`SelectionMenu.tsx:127-145`) — и при живом выделении,
  // и в режиме правки заметки. Флаг обязан покрывать и этот случай, иначе
  // одно нажатие закрывало бы меню И раскрывало панели. В Chromium,
  // Firefox и Mobile Chrome, где выделение работает, это воспроизводимо.
  it('Escape молчит при открытом меню выделения, а не только при панели', () => {
    const onToggleUI = vi.fn();
    const { rerender } = renderHook(
      ({ overlay }: { overlay: boolean }) =>
        useKeyboardNavigation({
          onNext: vi.fn(),
          onPrev: vi.fn(),
          onToggleUI,
          // ровно то, что собирает EpubReader: панели ИЛИ выделение ИЛИ правка
          escapeHandledByOverlay: overlay,
        }),
      { initialProps: { overlay: true } }
    );

    press('Escape');
    expect(onToggleUI).not.toHaveBeenCalled();

    // Меню закрылось — Escape снова принадлежит читалке.
    rerender({ overlay: false });
    press('Escape');
    expect(onToggleUI).toHaveBeenCalledTimes(1);
  });

  it('стрелки листают и при открытом оверлее — Escape их не касается', () => {
    const onNext = vi.fn();
    const onPrev = vi.fn();
    renderHook(() =>
      useKeyboardNavigation({
        onNext,
        onPrev,
        onToggleUI: vi.fn(),
        escapeHandledByOverlay: true,
      })
    );

    press('ArrowRight');
    press('ArrowLeft');

    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onPrev).toHaveBeenCalledTimes(1);
  });

  it('без onToggleUI Escape не трогает навигацию', () => {
    const onNext = vi.fn();
    renderHook(() => useKeyboardNavigation({ onNext, onPrev: vi.fn() }));

    press('Escape');

    expect(onNext).not.toHaveBeenCalled();
  });
});
