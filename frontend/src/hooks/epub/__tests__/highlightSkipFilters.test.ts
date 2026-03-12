/**
 * Tests for highlighting skip filters and cleanup without normalize()
 *
 * Verifies that:
 * 1. TreeWalker filters correctly skip nodes inside other highlighting systems
 * 2. Cleanup without normalize() preserves spans of other systems
 * 3. Cleanup with normalize() (negative test) demonstrates the destruction problem
 *
 * Three highlighting systems:
 * - .description-highlight (useDescriptionHighlighting)
 * - .entity-mention (useEntityNameHighlighting)
 * - .user-annotation (useAnnotationRendering)
 */

import { describe, it, expect } from 'vitest';

// ============================================================================
// Helper: Create a document with mixed highlighting spans
// ============================================================================

function createMixedHighlightDoc(): Document {
  const doc = document.implementation.createHTMLDocument('test');
  const p = doc.createElement('p');

  p.appendChild(doc.createTextNode('Normal text before. '));

  const descSpan = doc.createElement('span');
  descSpan.className = 'description-highlight';
  descSpan.setAttribute('data-description-id', 'd1');
  descSpan.textContent = 'Description text here';
  p.appendChild(descSpan);

  p.appendChild(doc.createTextNode(' Middle text between highlights. '));

  const entitySpan = doc.createElement('span');
  entitySpan.className = 'entity-mention';
  entitySpan.setAttribute('data-entity-id', 'e1');
  entitySpan.textContent = 'Entity name';
  p.appendChild(entitySpan);

  p.appendChild(doc.createTextNode(' Another normal text. '));

  const annotationSpan = doc.createElement('span');
  annotationSpan.className = 'user-annotation';
  annotationSpan.setAttribute('data-bookmark-id', 'b1');
  annotationSpan.textContent = 'User annotation text';
  p.appendChild(annotationSpan);

  p.appendChild(doc.createTextNode(' Final text after all.'));

  doc.body.appendChild(p);
  return doc;
}

// ============================================================================
// Helper: Create TreeWalker filter functions matching each highlighting system
// ============================================================================

/**
 * Filter for useDescriptionHighlighting TreeWalker.
 * Should REJECT nodes inside: .description-highlight, .entity-mention, .user-annotation
 */
function descriptionWalkerFilter(node: Node): number {
  const parent = node.parentElement;
  if (!parent) return NodeFilter.FILTER_REJECT;
  if (
    parent.classList.contains('description-highlight') ||
    parent.classList.contains('entity-mention') ||
    parent.classList.contains('user-annotation')
  ) {
    return NodeFilter.FILTER_REJECT;
  }
  return NodeFilter.FILTER_ACCEPT;
}

/**
 * Filter for useEntityNameHighlighting TreeWalker.
 * Should REJECT nodes inside: .entity-mention, .description-highlight, .user-annotation
 */
function entityWalkerFilter(node: Node): number {
  const parent = node.parentElement;
  if (!parent) return NodeFilter.FILTER_REJECT;
  if (
    parent.classList.contains('entity-mention') ||
    parent.classList.contains('description-highlight') ||
    parent.classList.contains('user-annotation')
  ) {
    return NodeFilter.FILTER_REJECT;
  }
  return NodeFilter.FILTER_ACCEPT;
}

// ============================================================================
// Tests: Skip Filters
// ============================================================================

describe('Highlighting skip filters', () => {
  describe('useDescriptionHighlighting walker filter', () => {
    it('REJECTS text nodes inside .description-highlight', () => {
      const doc = createMixedHighlightDoc();
      const descSpan = doc.querySelector('.description-highlight')!;
      const textNode = descSpan.firstChild!;

      expect(descriptionWalkerFilter(textNode)).toBe(NodeFilter.FILTER_REJECT);
    });

    it('REJECTS text nodes inside .entity-mention', () => {
      const doc = createMixedHighlightDoc();
      const entitySpan = doc.querySelector('.entity-mention')!;
      const textNode = entitySpan.firstChild!;

      expect(descriptionWalkerFilter(textNode)).toBe(NodeFilter.FILTER_REJECT);
    });

    it('REJECTS text nodes inside .user-annotation', () => {
      const doc = createMixedHighlightDoc();
      const annotationSpan = doc.querySelector('.user-annotation')!;
      const textNode = annotationSpan.firstChild!;

      expect(descriptionWalkerFilter(textNode)).toBe(NodeFilter.FILTER_REJECT);
    });

    it('ACCEPTS normal text nodes not inside any highlight', () => {
      const doc = createMixedHighlightDoc();
      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
        acceptNode: descriptionWalkerFilter,
      });

      const acceptedTexts: string[] = [];
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const text = node.textContent?.trim();
        if (text) acceptedTexts.push(text);
      }

      // Should only get normal text, not text inside any highlight span
      expect(acceptedTexts).toContain('Normal text before.');
      expect(acceptedTexts).toContain('Middle text between highlights.');
      expect(acceptedTexts).toContain('Another normal text.');
      expect(acceptedTexts).toContain('Final text after all.');

      // Should NOT contain text from any highlighting spans
      expect(acceptedTexts).not.toContain('Description text here');
      expect(acceptedTexts).not.toContain('Entity name');
      expect(acceptedTexts).not.toContain('User annotation text');
    });
  });

  describe('useEntityNameHighlighting walker filter', () => {
    it('REJECTS text nodes inside .user-annotation', () => {
      const doc = createMixedHighlightDoc();
      const annotationSpan = doc.querySelector('.user-annotation')!;
      const textNode = annotationSpan.firstChild!;

      expect(entityWalkerFilter(textNode)).toBe(NodeFilter.FILTER_REJECT);
    });

    it('REJECTS text nodes inside .entity-mention', () => {
      const doc = createMixedHighlightDoc();
      const entitySpan = doc.querySelector('.entity-mention')!;
      const textNode = entitySpan.firstChild!;

      expect(entityWalkerFilter(textNode)).toBe(NodeFilter.FILTER_REJECT);
    });

    it('REJECTS text nodes inside .description-highlight', () => {
      const doc = createMixedHighlightDoc();
      const descSpan = doc.querySelector('.description-highlight')!;
      const textNode = descSpan.firstChild!;

      expect(entityWalkerFilter(textNode)).toBe(NodeFilter.FILTER_REJECT);
    });

    it('ACCEPTS normal text nodes', () => {
      const doc = createMixedHighlightDoc();
      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
        acceptNode: entityWalkerFilter,
      });

      const acceptedTexts: string[] = [];
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const text = node.textContent?.trim();
        if (text) acceptedTexts.push(text);
      }

      expect(acceptedTexts).toContain('Normal text before.');
      expect(acceptedTexts).not.toContain('User annotation text');
      expect(acceptedTexts).not.toContain('Description text here');
      expect(acceptedTexts).not.toContain('Entity name');
    });
  });
});

// ============================================================================
// Tests: Cleanup without normalize()
// ============================================================================

describe('Cleanup without normalize()', () => {
  it('replaceChild preserves spans of other systems (no normalize)', () => {
    const doc = document.implementation.createHTMLDocument('test');
    const p = doc.createElement('p');
    p.appendChild(doc.createTextNode('Before '));
    const descSpan = doc.createElement('span');
    descSpan.className = 'description-highlight';
    descSpan.textContent = 'desc text';
    p.appendChild(descSpan);
    p.appendChild(doc.createTextNode(' middle '));
    const entitySpan = doc.createElement('span');
    entitySpan.className = 'entity-mention';
    entitySpan.textContent = 'entity';
    p.appendChild(entitySpan);
    p.appendChild(doc.createTextNode(' after'));
    doc.body.appendChild(p);

    // Cleanup description-highlight spans WITHOUT normalize
    const descSpans = doc.querySelectorAll('.description-highlight');
    descSpans.forEach((el) => {
      const parent = el.parentNode;
      if (parent) {
        parent.replaceChild(doc.createTextNode(el.textContent || ''), el);
        // NO normalize() call
      }
    });

    // Description span should be gone
    expect(doc.querySelectorAll('.description-highlight').length).toBe(0);
    // Entity span should be preserved
    expect(doc.querySelectorAll('.entity-mention').length).toBe(1);
    expect(doc.querySelector('.entity-mention')!.textContent).toBe('entity');

    // Text content should be preserved (may have adjacent text nodes)
    expect(p.textContent).toBe('Before desc text middle entity after');
  });

  it('replaceChild preserves user-annotation when cleaning entity-mention (no normalize)', () => {
    const doc = document.implementation.createHTMLDocument('test');
    const p = doc.createElement('p');
    p.appendChild(doc.createTextNode('Start '));
    const entitySpan = doc.createElement('span');
    entitySpan.className = 'entity-mention';
    entitySpan.textContent = 'entity';
    p.appendChild(entitySpan);
    p.appendChild(doc.createTextNode(' gap '));
    const annotationSpan = doc.createElement('span');
    annotationSpan.className = 'user-annotation';
    annotationSpan.textContent = 'note';
    p.appendChild(annotationSpan);
    p.appendChild(doc.createTextNode(' end'));
    doc.body.appendChild(p);

    // Cleanup entity-mention spans WITHOUT normalize
    const entitySpans = doc.querySelectorAll('.entity-mention');
    entitySpans.forEach((el) => {
      const parent = el.parentNode;
      if (parent) {
        parent.replaceChild(doc.createTextNode(el.textContent || ''), el);
        // NO normalize()
      }
    });

    // Entity span gone, user-annotation preserved
    expect(doc.querySelectorAll('.entity-mention').length).toBe(0);
    expect(doc.querySelectorAll('.user-annotation').length).toBe(1);
    expect(doc.querySelector('.user-annotation')!.textContent).toBe('note');
  });

  it('normalize() after replaceChild MERGES adjacent text nodes (negative test)', () => {
    const doc = document.implementation.createHTMLDocument('test');
    const p = doc.createElement('p');
    p.appendChild(doc.createTextNode('A '));
    const span = doc.createElement('span');
    span.className = 'description-highlight';
    span.textContent = 'B';
    p.appendChild(span);
    p.appendChild(doc.createTextNode(' C'));
    doc.body.appendChild(p);

    // Count child nodes before: "A " (text) + span + " C" (text) = 3 nodes
    const childCountBefore = p.childNodes.length;
    expect(childCountBefore).toBe(3);

    // Replace span with text node
    const descSpan = doc.querySelector('.description-highlight')!;
    p.replaceChild(doc.createTextNode('B'), descSpan);

    // After replaceChild: "A " (text) + "B" (text) + " C" (text) = 3 text nodes
    const childCountAfterReplace = p.childNodes.length;
    expect(childCountAfterReplace).toBe(3);

    // After normalize: all text nodes merge into one
    p.normalize();
    const childCountAfterNormalize = p.childNodes.length;
    expect(childCountAfterNormalize).toBe(1);
    expect(p.textContent).toBe('A B C');
  });

  it('normalize() shifts text node structure for CFI offset tracking (negative test)', () => {
    const doc = document.implementation.createHTMLDocument('test');
    const p = doc.createElement('p');

    // Structure: text(0-5) + desc-span + text(0-7) + entity-span + text(0-4)
    p.appendChild(doc.createTextNode('Hello '));
    const descSpan = doc.createElement('span');
    descSpan.className = 'description-highlight';
    descSpan.textContent = 'world';
    p.appendChild(descSpan);
    p.appendChild(doc.createTextNode(' middle '));
    const entitySpan = doc.createElement('span');
    entitySpan.className = 'entity-mention';
    entitySpan.textContent = 'entity';
    p.appendChild(entitySpan);
    p.appendChild(doc.createTextNode(' end'));
    doc.body.appendChild(p);

    // Remove description span
    p.replaceChild(doc.createTextNode('world'), descSpan);

    // Before normalize: entity span still has 2 separate text nodes before it
    const textNodesBeforeNormalize = Array.from(p.childNodes).filter(
      (n) => n.nodeType === Node.TEXT_NODE
    );
    expect(textNodesBeforeNormalize.length).toBe(4); // "Hello ", "world", " middle ", " end"

    // After normalize: text nodes merge, breaking any offset-based tracking
    p.normalize();

    const textNodesAfterNormalize = Array.from(p.childNodes).filter(
      (n) => n.nodeType === Node.TEXT_NODE
    );
    // Only 2 text nodes remain: "Hello world middle " and " end"
    // (entity span element separates them)
    expect(textNodesAfterNormalize.length).toBe(2);
    expect(textNodesAfterNormalize[0].textContent).toBe('Hello world middle ');
  });
});
