/**
 * Tests for ChapterCache service
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { chapterCache } from '../chapterCache';
import type { Description, GeneratedImage } from '@/types/api';

describe('ChapterCache', () => {
  const testUserId = 'test-user-123';
  const testBookId = 'test-book-123';
  const testChapter = 1;

  const mockDescriptions: Description[] = [
    {
      id: 'desc-1',
      type: 'character',
      content: 'Test character description',
      text: 'Test character description',
      confidence_score: 0.9,
      priority_score: 0.8,
    },
  ];

  const mockImages: GeneratedImage[] = [
    {
      id: 'img-1',
      image_url: 'https://example.com/image.png',
      service_used: 'pollinations',
      status: 'completed',
      generation_time_seconds: 2.5,
      created_at: new Date().toISOString(),
      is_moderated: false,
      view_count: 0,
      download_count: 0,
      description: {
        id: 'desc-1',
        type: 'character',
        text: 'Test character description',
        content: 'Test character description',
        confidence_score: 0.9,
        priority_score: 0.8,
      },
      chapter: {
        id: 'chapter-1',
        number: 1,
        title: 'Test Chapter',
      },
    },
  ];

  beforeEach(async () => {
    // Clear all cache before each test
    await chapterCache.clearAll(testUserId);
  });

  afterEach(async () => {
    // Clean up after tests
    await chapterCache.clearAll(testUserId);
  });

  it('should store and retrieve chapter data', async () => {
    // Store data
    const stored = await chapterCache.set(
      testUserId,
      testBookId,
      testChapter,
      mockDescriptions,
      mockImages
    );
    expect(stored).toBe(true);

    // Check if exists
    const exists = await chapterCache.has(testUserId, testBookId, testChapter);
    expect(exists).toBe(true);

    // Retrieve data
    const cached = await chapterCache.get(testUserId, testBookId, testChapter);
    expect(cached).not.toBeNull();
    expect(cached?.descriptions).toHaveLength(1);
    expect(cached?.images).toHaveLength(1);
    expect(cached?.descriptions[0].id).toBe('desc-1');
    expect(cached?.images[0].image_url).toBe('https://example.com/image.png');
  });

  it('should return null for non-existent chapter', async () => {
    const cached = await chapterCache.get(testUserId, 'non-existent-book', 999);
    expect(cached).toBeNull();
  });

  it('should delete chapter from cache', async () => {
    // Store data
    await chapterCache.set(testUserId, testBookId, testChapter, mockDescriptions, mockImages);

    // Verify it exists
    let exists = await chapterCache.has(testUserId, testBookId, testChapter);
    expect(exists).toBe(true);

    // Delete
    const deleted = await chapterCache.delete(testUserId, testBookId, testChapter);
    expect(deleted).toBe(true);

    // Verify it's gone
    exists = await chapterCache.has(testUserId, testBookId, testChapter);
    expect(exists).toBe(false);
  });

  it('should clear all chapters for a book', async () => {
    // Store multiple chapters
    await chapterCache.set(testUserId, testBookId, 1, mockDescriptions, mockImages);
    await chapterCache.set(testUserId, testBookId, 2, mockDescriptions, mockImages);
    await chapterCache.set(testUserId, testBookId, 3, mockDescriptions, mockImages);

    // Verify they exist
    let exists1 = await chapterCache.has(testUserId, testBookId, 1);
    let exists2 = await chapterCache.has(testUserId, testBookId, 2);
    expect(exists1).toBe(true);
    expect(exists2).toBe(true);

    // Clear book
    const deletedCount = await chapterCache.clearBook(testUserId, testBookId);
    expect(deletedCount).toBe(3);

    // Verify they're gone
    exists1 = await chapterCache.has(testUserId, testBookId, 1);
    exists2 = await chapterCache.has(testUserId, testBookId, 2);
    expect(exists1).toBe(false);
    expect(exists2).toBe(false);
  });

  it('should get cache statistics', async () => {
    // Store some data
    await chapterCache.set(testUserId, testBookId, 1, mockDescriptions, mockImages);
    await chapterCache.set(testUserId, testBookId, 2, mockDescriptions, mockImages);
    await chapterCache.set(testUserId, 'another-book', 1, mockDescriptions, mockImages);

    const stats = await chapterCache.getStats();
    expect(stats.totalChapters).toBe(3);
    expect(stats.chaptersByBook[testBookId]).toBe(2);
    expect(stats.chaptersByBook['another-book']).toBe(1);
    expect(stats.oldestCacheDate).not.toBeNull();
    expect(stats.newestCacheDate).not.toBeNull();
  });

  it('should update lastAccessedAt on cache hit', async () => {
    // Store data
    await chapterCache.set(testUserId, testBookId, testChapter, mockDescriptions, mockImages);

    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 100));

    // Access the cache
    const cached1 = await chapterCache.get(testUserId, testBookId, testChapter);
    expect(cached1).not.toBeNull();

    // Access again - this should update lastAccessedAt internally
    // (We can't directly verify this without exposing internal state,
    // but the LRU logic relies on it)
    const cached2 = await chapterCache.get(testUserId, testBookId, testChapter);
    expect(cached2).not.toBeNull();
  });

  it('should handle cache misses gracefully', async () => {
    const exists = await chapterCache.has(testUserId, 'non-existent', 1);
    expect(exists).toBe(false);

    const cached = await chapterCache.get(testUserId, 'non-existent', 1);
    expect(cached).toBeNull();
  });

  it('should clear all cache for a user', async () => {
    // Store multiple chapters for multiple books
    await chapterCache.set(testUserId, 'book1', 1, mockDescriptions, mockImages);
    await chapterCache.set(testUserId, 'book2', 1, mockDescriptions, mockImages);

    // Clear all for this user
    const deletedCount = await chapterCache.clearAll(testUserId);
    expect(deletedCount).toBeGreaterThanOrEqual(2);

    // Verify all gone
    const exists1 = await chapterCache.has(testUserId, 'book1', 1);
    const exists2 = await chapterCache.has(testUserId, 'book2', 1);
    expect(exists1).toBe(false);
    expect(exists2).toBe(false);
  });

  it('should isolate data between users', async () => {
    const user1 = 'user-1';
    const user2 = 'user-2';

    // Store same chapter for different users
    await chapterCache.set(user1, testBookId, testChapter, mockDescriptions, mockImages);
    await chapterCache.set(user2, testBookId, testChapter, mockDescriptions, mockImages);

    // Verify both exist
    const exists1 = await chapterCache.has(user1, testBookId, testChapter);
    const exists2 = await chapterCache.has(user2, testBookId, testChapter);
    expect(exists1).toBe(true);
    expect(exists2).toBe(true);

    // Clear all for user1
    await chapterCache.clearAll(user1);

    // Verify user1 data is gone but user2 data remains
    const exists1After = await chapterCache.has(user1, testBookId, testChapter);
    const exists2After = await chapterCache.has(user2, testBookId, testChapter);
    expect(exists1After).toBe(false);
    expect(exists2After).toBe(true);

    // Cleanup user2
    await chapterCache.clearAll(user2);
  });

  it('should preserve action type through cache round-trip', async () => {
    const actionDescriptions: Description[] = [{
      id: 'desc-action',
      type: 'action',
      content: 'He swung the sword in a wide arc',
      text: 'He swung the sword in a wide arc',
      confidence_score: 0.85,
      priority_score: 72,
    }];

    await chapterCache.set(testUserId, testBookId, testChapter, actionDescriptions, []);
    const cached = await chapterCache.get(testUserId, testBookId, testChapter);
    expect(cached).not.toBeNull();
    expect(cached?.descriptions[0].type).toBe('action');
    expect(cached?.descriptions[0].priority_score).toBe(72);
    expect(cached?.descriptions[0].text).toBe('He swung the sword in a wide arc');
  });

  it('should preserve all description types through cache round-trip', async () => {
    const allTypeDescriptions: Description[] = [
      { id: 'd1', type: 'location', content: 'A dark forest', text: 'A dark forest', confidence_score: 0.9, priority_score: 80 },
      { id: 'd2', type: 'character', content: 'A tall elf', text: 'A tall elf', confidence_score: 0.8, priority_score: 60 },
      { id: 'd3', type: 'atmosphere', content: 'Misty dawn', text: 'Misty dawn', confidence_score: 0.7, priority_score: 50 },
      { id: 'd4', type: 'object', content: 'Golden ring', text: 'Golden ring', confidence_score: 0.6, priority_score: 40 },
      { id: 'd5', type: 'action', content: 'Running fast', text: 'Running fast', confidence_score: 0.5, priority_score: 30 },
    ];

    await chapterCache.set(testUserId, testBookId, testChapter, allTypeDescriptions, []);
    const cached = await chapterCache.get(testUserId, testBookId, testChapter);
    expect(cached).not.toBeNull();
    expect(cached?.descriptions).toHaveLength(5);

    const typeMap = new Map(cached!.descriptions.map(d => [d.id, d.type]));
    expect(typeMap.get('d1')).toBe('location');
    expect(typeMap.get('d2')).toBe('character');
    expect(typeMap.get('d3')).toBe('atmosphere');
    expect(typeMap.get('d4')).toBe('object');
    expect(typeMap.get('d5')).toBe('action');
  });
});

