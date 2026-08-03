/**
 * Изоляция ключей TanStack Query.
 *
 * Инвалидация в TanStack Query работает по ПРЕФИКСУ: `['a','b']` задевает
 * `['a','b','c']`. Поэтому вложенность ключей — не косметика, а поведение,
 * и её нужно защищать тестом.
 */

import { describe, it, expect } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { bookKeys, chapterKeys, descriptionKeys, entityKeys, imageKeys } from '../queryKeys';

const USER = 'user-1';
const BOOK = 'book-1';
const OTHER_BOOK = 'book-2';
const OTHER_USER = 'user-2';

/** Ключ считается задетым, если фильтр инвалидации ему соответствует. */
const matches = (filterKey: readonly unknown[], targetKey: readonly unknown[]) => {
  const client = new QueryClient();
  client.setQueryData(targetKey, { seeded: true });
  client.invalidateQueries({ queryKey: [...filterKey] });
  const state = client.getQueryState([...targetKey]);
  const invalidated = state?.isInvalidated ?? false;
  client.clear();
  return invalidated;
};

describe('queryKeys prefix isolation', () => {
  it('does not invalidate the entity network when book detail is invalidated', () => {
    // Регрессия инцидента 2026-08-05. Граф сущностей жил под ключом
    // `['book', bookId, 'entities', chapter]`, то есть был ПОДключом деталей
    // книги: каждая инвалидация деталей перезапрашивала самый дорогой
    // эндпоинт читалки, что и раскручивало цикл перезапросов.
    expect(
      matches(bookKeys.detail(USER, BOOK), entityKeys.network(USER, BOOK, 60))
    ).toBe(false);
    expect(matches(bookKeys.detail(USER, BOOK), entityKeys.network(USER, BOOK))).toBe(false);
    expect(matches(bookKeys.all(USER), entityKeys.network(USER, BOOK, 60))).toBe(false);
  });

  it('invalidates every loaded chapter of the entity network from the book-level key', () => {
    // Обратная сторона: когда обработка книги закончилась, обновить нужно ВСЕ
    // уже загруженные главы графа, а не одну.
    expect(matches(entityKeys.byBook(USER, BOOK), entityKeys.network(USER, BOOK, 1))).toBe(true);
    expect(matches(entityKeys.byBook(USER, BOOK), entityKeys.network(USER, BOOK, 60))).toBe(true);
    expect(matches(entityKeys.byBook(USER, BOOK), entityKeys.network(USER, BOOK))).toBe(true);
  });

  it('keeps entity data of different books and users apart', () => {
    expect(matches(entityKeys.byBook(USER, BOOK), entityKeys.network(USER, OTHER_BOOK, 1))).toBe(
      false
    );
    expect(matches(entityKeys.byBook(USER, BOOK), entityKeys.network(OTHER_USER, BOOK, 1))).toBe(
      false
    );
  });

  it('treats chapters, descriptions and images as separate namespaces from book detail', () => {
    expect(matches(bookKeys.detail(USER, BOOK), chapterKeys.byBook(USER, BOOK))).toBe(false);
    expect(matches(bookKeys.detail(USER, BOOK), descriptionKeys.byBook(USER, BOOK))).toBe(false);
    expect(matches(bookKeys.detail(USER, BOOK), imageKeys.byBook(USER, BOOK))).toBe(false);
  });

  it('scopes book detail to its own user', () => {
    expect(matches(bookKeys.detail(USER, BOOK), bookKeys.detail(OTHER_USER, BOOK))).toBe(false);
    expect(matches(bookKeys.all(USER), bookKeys.detail(USER, BOOK))).toBe(true);
  });
});
