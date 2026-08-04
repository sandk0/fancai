/**
 * useKeyboardNavigation - Shared keyboard shortcuts for navigation
 *
 * Provides keyboard navigation with support for both window and iframe contexts.
 * Handles ArrowLeft, ArrowRight, ArrowUp, ArrowDown, Space and Escape keys.
 *
 * @param options - Navigation options
 * @param options.onNext - Function to go to next page
 * @param options.onPrev - Function to go to previous page
 * @param options.onToggleUI - Show/hide reader panels (Escape); the only route
 *   to them on WebKit engines
 * @param options.escapeHandledByOverlay - An overlay (panel or selection menu)
 *   already owns Escape, so the reader must not act on it
 * @param options.enabled - Whether keyboard navigation is enabled (default: true)
 * @param options.rendition - Optional epub.js Rendition for iframe keyboard events
 *
 * @example
 * // Simple usage (BookReader)
 * useKeyboardNavigation({ onNext: nextPage, onPrev: prevPage });
 *
 * @example
 * // With epub.js iframe support (EpubReader)
 * useKeyboardNavigation({
 *   onNext: nextPage,
 *   onPrev: prevPage,
 *   enabled: renditionReady && !isModalOpen,
 *   rendition
 * });
 */

import { useEffect } from 'react';
import type { Rendition } from '@/types/epub';

interface UseKeyboardNavigationOptions {
  onNext: () => void;
  onPrev: () => void;
  /**
   * Показать/скрыть панели читалки.
   *
   * Единственный путь к панелям на движках WebKit. epub.js рисует книгу в
   * iframe с `sandbox="allow-same-origin"` (без `allow-scripts`), а WebKit
   * не доставляет в такой документ НИ ОДНОГО события — ни мыши, ни касания.
   * Проверено на движке: тот же клик в iframe без sandbox доходит, в
   * засэндбоксенный — нет, во всех трёх движках слушатель при этом
   * навешивается. Поэтому центральный тап, живущий на документе iframe,
   * в десктопном Safari не срабатывает никогда, и без клавиатуры панели
   * там недостижимы. Обработчик висит на родительском `window`, до
   * которого sandbox не достаёт.
   */
  onToggleUI?: () => void;
  /**
   * Escape уже принадлежит открытому оверлею — читалка его не трогает.
   *
   * Оверлеев несколько, и каждый вешает СВОЙ слушатель Escape: панели
   * (оглавление, настройки, поиск, ящики, попап сущности), а также
   * `SelectionMenu` — при живом выделении или в режиме правки заметки
   * (`SelectionMenu.tsx:127-145`, слушатель на `document`). Без этого флага
   * одно нажатие делало бы две вещи: закрывало оверлей И переключало шапку.
   *
   * Именно отдельный флаг, а не `enabled`: тот намеренно не выключается
   * при оверлеях, чтобы стрелки листали книгу и с открытым оглавлением.
   * И именно не `isPanelOpen`: меню выделения панелью не является, а Escape
   * забирает так же.
   */
  escapeHandledByOverlay?: boolean;
  enabled?: boolean;
  rendition?: Rendition | null;
}

export const useKeyboardNavigation = ({
  onNext,
  onPrev,
  onToggleUI,
  escapeHandledByOverlay = false,
  enabled = true,
  rendition,
}: UseKeyboardNavigationOptions): void => {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      // Нажатие уже израсходовал кто-то выше по всплытию — не трогаем его.
      // Флага `escapeHandledByOverlay` для этого НЕ достаточно: наш
      // слушатель висит на `window`, то есть последним, а React флашит
      // discrete-события синхронно. Оверлей успевает закрыться и сбросить
      // своё состояние ДО нас, эффект пересоздаётся с уже «пустым» флагом,
      // и guard пропускает нажатие. Поймано только e2e: юнит-тесты
      // подменяют настоящий `SelectionMenu` моком.
      if (e.defaultPrevented) {
        return;
      }

      switch (e.key) {
        case 'ArrowLeft':
        case 'ArrowUp':
          e.preventDefault();
          onPrev();
          break;
        case 'ArrowRight':
        case 'ArrowDown':
        case ' ':
          e.preventDefault();
          onNext();
          break;
        // Escape уже занят открытым оверлеем — он закрывается своим
        // слушателем, а мы молчим: иначе одно нажатие делало бы две вещи.
        case 'Escape':
          if (onToggleUI && !escapeHandledByOverlay) {
            e.preventDefault();
            onToggleUI();
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyPress);

    const attachToIframe = () => {
      const contents = rendition?.getContents();
      if (contents && contents[0]?.document) {
        contents[0].document.addEventListener('keydown', handleKeyPress);
      }
    };

    rendition?.on('rendered', attachToIframe);
    attachToIframe();

    return () => {
      window.removeEventListener('keydown', handleKeyPress);
      rendition?.off('rendered', attachToIframe);
      const contents = rendition?.getContents();
      if (contents && contents[0]?.document) {
        contents[0].document.removeEventListener('keydown', handleKeyPress);
      }
    };
  }, [onNext, onPrev, onToggleUI, escapeHandledByOverlay, enabled, rendition]);
};
