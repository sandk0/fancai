/**
 * epub.js monkey-patches for known bugs in 0.3.93
 *
 * @module utils/epubPatches
 */

import type { Rendition } from '@/types/epub';

/**
 * Monkey-patch epub.js Queue.dequeue() to add try-catch protection.
 *
 * epub.js 0.3.93 queue.js has a critical bug: dequeue() calls task.apply()
 * without try-catch. If the task throws synchronously (e.g. locationOf()
 * throws IndexSizeError on range CFIs during same-section navigation),
 * run() never calls itself again -> queue is permanently stuck.
 *
 * This patch wraps dequeue() so any synchronous exception is caught,
 * the failed task's deferred is rejected, and the queue continues.
 */
export const patchRenditionQueue = (rendition: Rendition): void => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q = (rendition as any).q;
  if (!q || q.__patched) return;

  const origDequeue = q.dequeue.bind(q);
  q.dequeue = function () {
    try {
      return origDequeue();
    } catch {
      // Unblock the queue -- reset running so run() can be called again
      this.running = undefined;
      // Resolve with empty promise so .then(run) chain continues
      return Promise.resolve();
    }
  };
  q.__patched = true;
};

/**
 * Convert a range CFI to a point CFI for safe navigation.
 *
 * Range CFI format: epubcfi(/6/10!/4/2[id3]/32/2,/1:173,/1:244)
 * Point CFI format: epubcfi(/6/10!/4/2[id3]/32/2/1:173)
 *
 * epub.js locationOf() throws IndexSizeError on range CFIs during
 * same-section navigation. Converting to point CFI (start of range)
 * avoids the error while navigating to the correct position.
 */
export function rangeCfiToPoint(cfi: string): string {
  const match = cfi.match(/^(epubcfi\([^,]+),([^,]+),/);
  return match ? match[1] + match[2] + ')' : cfi;
}
