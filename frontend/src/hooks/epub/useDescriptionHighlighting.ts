import { useEffect, useCallback, useRef, useMemo } from 'react';
import type { Rendition } from '@/types/epub';
import type { Description, GeneratedImage } from '@/types/api';
import type { DescriptionHighlightMode } from '@/stores/reader';
import {
  normalizeText,
  removeChapterHeaders,
  getFirstWords,
  buildIndexMap,
  mapNormalizedRange,
} from '@/utils/text-search/normalization';
import { strategies, type StrategyResult } from '@/utils/text-search/strategies';
import { addToCache, getFromCache, type SearchPatterns } from '@/utils/text-search/cache';

export type DescriptionDensity = 'all' | 'key' | 'off';

interface UseDescriptionHighlightingOptions {
  rendition: Rendition | null;
  descriptions: Description[];
  images: GeneratedImage[];
  onDescriptionClick: (description: Description, image?: GeneratedImage) => void;
  enabled?: boolean;
  density?: DescriptionDensity;
  highlightMode?: DescriptionHighlightMode;
}

const TYPE_COLORS: Record<string, { bg: string; border: string; active: string }> = {
  location: {
    bg: 'rgba(96,165,250,0.2)',
    border: 'rgba(96,165,250,0.6)',
    active: 'rgba(96,165,250,0.4)',
  },
  character: {
    bg: 'rgba(167,139,250,0.2)',
    border: 'rgba(167,139,250,0.6)',
    active: 'rgba(167,139,250,0.4)',
  },
  atmosphere: {
    bg: 'rgba(251,191,36,0.15)',
    border: 'rgba(251,191,36,0.5)',
    active: 'rgba(251,191,36,0.35)',
  },
  object: {
    bg: 'rgba(74,222,128,0.15)',
    border: 'rgba(74,222,128,0.5)',
    active: 'rgba(74,222,128,0.35)',
  },
  action: {
    bg: 'rgba(96,165,250,0.2)',
    border: 'rgba(96,165,250,0.6)',
    active: 'rgba(96,165,250,0.4)',
  },
};

/** Full-mode colors: lighter semi-transparent background, no border */
const TYPE_FULL_COLORS: Record<string, { bg: string; hover: string }> = {
  location: { bg: 'rgba(96,165,250,0.08)', hover: 'rgba(96,165,250,0.15)' },
  character: { bg: 'rgba(167,139,250,0.08)', hover: 'rgba(167,139,250,0.15)' },
  atmosphere: { bg: 'rgba(251,191,36,0.08)', hover: 'rgba(251,191,36,0.15)' },
  object: { bg: 'rgba(74,222,128,0.08)', hover: 'rgba(74,222,128,0.15)' },
  action: { bg: 'rgba(96,165,250,0.08)', hover: 'rgba(96,165,250,0.15)' },
};

const getTypeClass = (type: string): string => {
  const valid = ['location', 'character', 'atmosphere', 'object', 'action'];
  return valid.includes(type) ? `desc-${type}` : 'desc-location';
};

const getFullTypeClass = (type: string): string => {
  const valid = ['location', 'character', 'atmosphere', 'object', 'action'];
  return valid.includes(type) ? `desc-full-${type}` : 'desc-full-location';
};

const PRIORITY_THRESHOLD = 50;

const DEBOUNCE_DELAY_MS = 100;

const preprocessDescription = (desc: Description): SearchPatterns => {
  const cached = getFromCache(desc.id);
  if (cached) return cached;
  const content = desc.content || desc.text || '';
  const clean = removeChapterHeaders(content);
  const norm = normalizeText(clean);
  const patterns = {
    original: content,
    normalized: norm,
    first40: norm.substring(0, 40),
    skip10: norm.substring(10, 50),
    skip20: norm.substring(20, 80),
    firstWords: getFirstWords(norm, 5),
    middleSection: norm.substring(
      Math.floor(norm.length / 2) - 25,
      Math.floor(norm.length / 2) + 25
    ),
    firstSentence: norm.split(/[.!?]/)[0],
  };
  addToCache(desc.id, patterns);
  return patterns;
};

/**
 * Check if a node is inside a protected highlight (user-annotation or entity-mention).
 * Does NOT check description-highlight — those are cleaned up before re-processing.
 */
function isInsideProtectedHighlight(node: Node): boolean {
  let el = node.parentElement;
  while (el) {
    if (el.classList.contains('user-annotation') || el.classList.contains('entity-mention')) {
      return true;
    }
    el = el.parentElement;
  }
  return false;
}

/**
 * Wrap the full description content across multiple text nodes (full-mode).
 *
 * Starting from anchorNode (where the anchor fragment was found), walks forward
 * through sibling text nodes collecting text, finds descContent within it,
 * then wraps each matching text node (or portion) in a highlight span.
 *
 * @returns true if full wrapping succeeded, false if fallback to anchor needed
 */
function wrapFullDescription(
  doc: Document,
  anchorNode: Text,
  _anchorStartIdx: number,
  descContent: string,
  descData: Description,
  hasImage: boolean
): boolean {
  const normDesc = normalizeText(descContent);
  if (!normDesc) return false;

  // Collect consecutive text nodes starting from anchorNode's parent context
  // We need to walk text nodes in document order from anchorNode onward
  const parentEl = anchorNode.parentElement ?? doc.body;
  const walker = doc.createTreeWalker(parentEl, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      if (isInsideProtectedHighlight(n)) return NodeFilter.FILTER_REJECT;
      if (!n.textContent?.trim()) return NodeFilter.FILTER_SKIP;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  // Advance walker to anchorNode
  let current: Node | null;
  while ((current = walker.nextNode())) {
    if (current === anchorNode) break;
  }
  if (current !== anchorNode) return false;

  // Collect text nodes and concatenated normalized text
  const textNodes: Text[] = [anchorNode];
  const nodeNorms: string[] = [normalizeText(anchorNode.textContent || '')];
  let concatenated = nodeNorms[0];

  // Check if the full description is already in the first node
  let foundInConcat = concatenated.indexOf(normDesc);

  // Keep collecting nodes until we find the full description or run out of siblings
  const MAX_NODES = 50; // safety limit
  while (foundInConcat === -1 && textNodes.length < MAX_NODES) {
    const next = walker.nextNode() as Text | null;
    if (!next) break;
    textNodes.push(next);
    const nextNorm = normalizeText(next.textContent || '');
    nodeNorms.push(nextNorm);
    concatenated += ' ' + nextNorm; // nodes are separated by space in normalized form
    foundInConcat = concatenated.indexOf(normDesc);
  }

  if (foundInConcat === -1) return false;

  // Now we know the full description spans from foundInConcat to foundInConcat + normDesc.length
  // in the concatenated normalized text. Map this back to individual nodes.
  const descNormEnd = foundInConcat + normDesc.length;

  // Build a per-node offset map: position of each node's text start in concatenated
  const nodeStarts: number[] = [];
  let pos = 0;
  for (let i = 0; i < nodeNorms.length; i++) {
    nodeStarts.push(pos);
    pos += nodeNorms[i].length;
    if (i < nodeNorms.length - 1) pos += 1; // for the joining space
  }

  // For each text node, determine if it overlaps with [foundInConcat, descNormEnd)
  for (let i = 0; i < textNodes.length; i++) {
    const nodeStart = nodeStarts[i];
    const nodeEnd = nodeStart + nodeNorms[i].length;

    // No overlap
    if (nodeEnd <= foundInConcat || nodeStart >= descNormEnd) continue;

    const node = textNodes[i];
    const origText = node.textContent || '';
    const indexMap = buildIndexMap(origText);

    // Overlap range in normalized coords relative to this node
    const overlapStart = Math.max(0, foundInConcat - nodeStart);
    const overlapEnd = Math.min(nodeNorms[i].length, descNormEnd - nodeStart);

    // Map normalized range back to original text positions
    const mapped = mapNormalizedRange(indexMap, origText, overlapStart, overlapEnd);

    const before = origText.substring(0, mapped.startIdx);
    const match = origText.substring(mapped.startIdx, mapped.endIdx);
    const after = origText.substring(mapped.endIdx);

    if (!match) continue;

    const frag = doc.createDocumentFragment();
    if (before) frag.appendChild(doc.createTextNode(before));

    const span = doc.createElement('span');
    span.className = `description-highlight description-highlight-full ${getFullTypeClass(descData.type)} ${hasImage ? 'has-image' : 'no-image'}`;
    span.setAttribute('data-description-id', descData.id);
    span.textContent = match;
    frag.appendChild(span);

    if (after) frag.appendChild(doc.createTextNode(after));
    node.parentNode?.replaceChild(frag, node);
  }

  return true;
}

export const useDescriptionHighlighting = ({
  rendition,
  descriptions,
  images,
  onDescriptionClick,
  enabled = true,
  density = 'all',
  highlightMode = 'anchor',
}: UseDescriptionHighlightingOptions) => {
  const processingRef = useRef(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastProcessedIds = useRef<string>('');

  // DEFENSIVE: Ensure input is array + apply density filter
  const safeDescriptions = useMemo(() => {
    const arr = Array.isArray(descriptions) ? descriptions : [];
    if (density === 'off') return [];
    if (density === 'key') return arr.filter((d) => d.priority_score > PRIORITY_THRESHOLD);
    return arr;
  }, [descriptions, density]);
  const imagesByDescId = useMemo(() => {
    const map = new Map<string, GeneratedImage>();
    if (Array.isArray(images))
      images.forEach((img) => {
        if (img.description_id) map.set(img.description_id, img);
      });
    return map;
  }, [images]);

  const findHighlightMatch = useCallback(
    (text: string, patterns: SearchPatterns, len: number): StrategyResult => {
      for (const s of strategies) {
        const result = s.fn(text, patterns, len);
        if (result.found) return result;
      }
      return { found: false };
    },
    []
  );

  const processContents = useCallback(
    async (force = false) => {
      if (!rendition || !enabled || safeDescriptions.length === 0 || processingRef.current) return;

      // Check if we need to re-process (include highlightMode in cache key)
      const currentIds =
        safeDescriptions
          .map((d) => d.id)
          .sort()
          .join(',') +
        '|' +
        highlightMode;
      const idsChanged = currentIds !== lastProcessedIds.current;

      try {
        const contents = rendition.getContents();
        if (!contents?.length) return;
        const doc = contents[0].document;
        if (!doc?.body) return;

        // OPTIMIZATION: If descriptions haven't changed and we already have highlights in DOM, skip
        // This prevents flashing/re-rendering on simple scroll/relocation events
        const hasHighlights = doc.querySelector('.description-highlight') !== null;
        if (!force && !idsChanged && hasHighlights) {
          return;
        }

        processingRef.current = true;
        lastProcessedIds.current = currentIds;

        // CLEANUP existing highlights (both anchor and full) to avoid duplicates
        const existing = doc.querySelectorAll('.description-highlight');
        existing.forEach((el) => {
          const p = el.parentNode;
          if (p) {
            p.replaceChild(doc.createTextNode(el.textContent || ''), el);
            p.normalize();
          }
        });

        const styleId = 'highlight-styles';
        const existingStyle = doc.getElementById(styleId);
        if (existingStyle) existingStyle.remove();
        const s = doc.createElement('style');
        s.id = styleId;
        // Anchor-mode styles (saturated with border-bottom)
        const anchorRules = Object.entries(TYPE_COLORS)
          .map(
            ([type, c]) =>
              `.desc-${type} { background: ${c.bg}; border-bottom: 2px solid ${c.border}; cursor: pointer; transition: background 0.2s; }
         .desc-${type}:hover { background: ${c.active}; }
         .desc-${type}.has-image { border-bottom-style: solid; }
         .desc-${type}.no-image { border-bottom-style: dashed; }`
          )
          .join('\n');
        // Full-mode styles (light semi-transparent background, no border)
        const fullRules = Object.entries(TYPE_FULL_COLORS)
          .map(
            ([type, c]) =>
              `.desc-full-${type} { background: ${c.bg}; cursor: pointer; transition: background 0.2s; }
         .desc-full-${type}:hover { background: ${c.hover}; }`
          )
          .join('\n');
        s.textContent = `.description-highlight { cursor: pointer; transition: background 0.2s; }\n${anchorRules}\n${fullRules}`;
        doc.head.appendChild(s);

        const processed = safeDescriptions.map((d) => ({
          data: d,
          patterns: preprocessDescription(d),
        }));
        const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
          acceptNode: (n) =>
            n.parentElement?.classList.contains('description-highlight')
              ? NodeFilter.FILTER_REJECT
              : NodeFilter.FILTER_ACCEPT,
        });

        const nodes: Text[] = [];
        let n;
        while ((n = walker.nextNode())) {
          if (n.textContent?.trim()) nodes.push(n as Text);
        }

        // Track which descriptions have been highlighted (for full-mode dedup)
        const highlightedDescIds = new Set<string>();

        const CHUNK = 30;
        for (let i = 0; i < nodes.length; i += CHUNK) {
          const chunk = nodes.slice(i, i + CHUNK);
          await new Promise<void>((res) => {
            const run = () => {
              chunk.forEach((node) => {
                const text = node.textContent;
                if (!text || text.length < 15) return;
                // Skip if node was already replaced (parent is null)
                if (!node.parentNode) return;
                const norm = normalizeText(text);
                const indexMap = buildIndexMap(text);
                for (const { data, patterns } of processed) {
                  // Skip if this description already highlighted (full-mode wraps multiple nodes)
                  if (highlightedDescIds.has(data.id)) continue;

                  const result = findHighlightMatch(norm, patterns, norm.length);
                  if (
                    result.found &&
                    result.startIdx !== undefined &&
                    result.endIdx !== undefined
                  ) {
                    if (highlightMode === 'full') {
                      // Full-mode: try to wrap the entire description content
                      const descContent = data.content || data.text || '';
                      const fullSuccess = wrapFullDescription(
                        doc,
                        node,
                        result.startIdx,
                        descContent,
                        data,
                        imagesByDescId.has(data.id)
                      );
                      if (fullSuccess) {
                        highlightedDescIds.add(data.id);
                        break;
                      }
                      // Fallback to anchor wrapping if full-mode failed
                    }

                    // Anchor-mode (or full-mode fallback): wrap just the matched fragment
                    const mapped = mapNormalizedRange(
                      indexMap,
                      text,
                      result.startIdx,
                      result.endIdx
                    );
                    const before = text.substring(0, mapped.startIdx);
                    const match = text.substring(mapped.startIdx, mapped.endIdx);
                    const after = text.substring(mapped.endIdx);

                    const frag = doc.createDocumentFragment();
                    if (before) frag.appendChild(doc.createTextNode(before));

                    const span = doc.createElement('span');
                    const hasImage = imagesByDescId.has(data.id);
                    span.className = `description-highlight ${getTypeClass(data.type)} ${hasImage ? 'has-image' : 'no-image'}`;
                    span.setAttribute('data-description-id', data.id);
                    span.textContent = match;
                    frag.appendChild(span);

                    if (after) frag.appendChild(doc.createTextNode(after));
                    node.parentNode?.replaceChild(frag, node);
                    highlightedDescIds.add(data.id);
                    break;
                  }
                }
              });
              res();
            };
            if ('requestIdleCallback' in window) window.requestIdleCallback(run);
            else setTimeout(run, 0);
          });
        }
      } finally {
        processingRef.current = false;
      }
    },
    [rendition, safeDescriptions, enabled, findHighlightMatch, imagesByDescId, highlightMode]
  );

  useEffect(() => {
    if (!rendition || !enabled) return;

    // iOS PWA FIX: Listen for clicks via rendition and message
    const handleClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t?.classList?.contains('description-highlight')) {
        const id = t.getAttribute('data-description-id');
        if (id) {
          e.preventDefault();
          e.stopPropagation();
          const d = safeDescriptions.find((x) => x.id === id);
          if (d) onDescriptionClick(d, imagesByDescId.get(id));
        }
      }
    };

    const handleMessage = (e: MessageEvent) => {
      if (e.data?.type === 'DESCRIPTION_CLICK' && e.data.id) {
        const d = safeDescriptions.find((x) => x.id === e.data.id);
        if (d) onDescriptionClick(d, imagesByDescId.get(e.data.id));
      }
    };

    const handle = () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(processContents, DEBOUNCE_DELAY_MS);
    };

    rendition.on('rendered', handle);
    rendition.on('relocated', handle);
    rendition.on('click', handleClick as (e: unknown) => void);
    window.addEventListener('message', handleMessage);
    handle();

    return () => {
      rendition.off('rendered', handle);
      rendition.off('relocated', handle);
      rendition.off('click', handleClick as (e: unknown) => void);
      window.removeEventListener('message', handleMessage);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [rendition, processContents, enabled, safeDescriptions, imagesByDescId, onDescriptionClick]);

  // Force re-highlight when descriptions load late
  const prevCount = useRef(0);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    if (safeDescriptions.length > 0 && prevCount.current === 0) {
      timer = setTimeout(processContents, 200);
    }
    prevCount.current = safeDescriptions.length;
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [safeDescriptions.length, processContents]);

  return { findHighlightMatch };
};
