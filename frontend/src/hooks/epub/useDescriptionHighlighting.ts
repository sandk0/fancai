import { useEffect, useCallback, useRef, useMemo } from 'react';
import type { Rendition } from '@/types/epub';
import type { Description, GeneratedImage } from '@/types/api';
import { normalizeText, removeChapterHeaders, getFirstWords } from '@/utils/text-search/normalization';
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
}

const TYPE_COLORS: Record<string, { bg: string; border: string; active: string }> = {
  location:   { bg: 'rgba(96,165,250,0.2)',  border: 'rgba(96,165,250,0.6)',  active: 'rgba(96,165,250,0.4)' },
  character:  { bg: 'rgba(167,139,250,0.2)', border: 'rgba(167,139,250,0.6)', active: 'rgba(167,139,250,0.4)' },
  atmosphere: { bg: 'rgba(251,191,36,0.15)', border: 'rgba(251,191,36,0.5)',  active: 'rgba(251,191,36,0.35)' },
  object:     { bg: 'rgba(74,222,128,0.15)', border: 'rgba(74,222,128,0.5)',  active: 'rgba(74,222,128,0.35)' },
  action:     { bg: 'rgba(96,165,250,0.2)',  border: 'rgba(96,165,250,0.6)',  active: 'rgba(96,165,250,0.4)' },
};

const getTypeClass = (type: string): string => {
  const valid = ['location', 'character', 'atmosphere', 'object', 'action'];
  return valid.includes(type) ? `desc-${type}` : 'desc-location';
};

const PRIORITY_THRESHOLD = 50;

const DEBOUNCE_DELAY_MS = 100;

const preprocessDescription = (desc: Description): SearchPatterns => {
  const cached = getFromCache(desc.id);
  if (cached) return cached;
  const content = desc.text || desc.content || '';
  const clean = removeChapterHeaders(content);
  const norm = normalizeText(clean);
  const patterns = {
    original: content, normalized: norm,
    first40: norm.substring(0, 40),
    skip10: norm.substring(10, 50),
    skip20: norm.substring(20, 80),
    firstWords: getFirstWords(norm, 5),
    middleSection: norm.substring(Math.floor(norm.length / 2) - 25, Math.floor(norm.length / 2) + 25),
    firstSentence: norm.split(/[.!?]/)[0],
  };
  addToCache(desc.id, patterns);
  return patterns;
};

export const useDescriptionHighlighting = ({
  rendition, descriptions, images, onDescriptionClick, enabled = true, density = 'all',
}: UseDescriptionHighlightingOptions) => {
  const processingRef = useRef(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastProcessedIds = useRef<string>('');

  // DEFENSIVE: Ensure input is array + apply density filter
  const safeDescriptions = useMemo(() => {
    const arr = Array.isArray(descriptions) ? descriptions : [];
    if (density === 'off') return [];
    if (density === 'key') return arr.filter(d => d.priority_score > PRIORITY_THRESHOLD);
    return arr;
  }, [descriptions, density]);
  const imagesByDescId = useMemo(() => {
    const map = new Map<string, GeneratedImage>();
    if (Array.isArray(images)) images.forEach(img => { if (img.description_id) map.set(img.description_id, img); });
    return map;
  }, [images]);

  const findHighlightMatch = useCallback((text: string, patterns: SearchPatterns, len: number): StrategyResult => {
    for (const s of strategies) {
      const result = s.fn(text, patterns, len);
      if (result.found) return result;
    }
    return { found: false };
  }, []);

  const processContents = useCallback(async (force = false) => {
    if (!rendition || !enabled || safeDescriptions.length === 0 || processingRef.current) return;
    
    // Check if we need to re-process
    const currentIds = safeDescriptions.map(d => d.id).sort().join(',');
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

      // CLEANUP existing highlights to avoid duplicates
      const existing = doc.querySelectorAll('.description-highlight');
      existing.forEach(el => {
        const p = el.parentNode;
        if (p) { p.replaceChild(doc.createTextNode(el.textContent || ''), el); p.normalize(); }
      });

      const styleId = 'highlight-styles';
      const existingStyle = doc.getElementById(styleId);
      if (existingStyle) existingStyle.remove();
      const s = doc.createElement('style'); s.id = styleId;
      const rules = Object.entries(TYPE_COLORS).map(([type, c]) =>
        `.desc-${type} { background: ${c.bg}; border-bottom: 2px solid ${c.border}; cursor: pointer; transition: background 0.2s; }
         .desc-${type}:hover { background: ${c.active}; }
         .desc-${type}.has-image { border-bottom-style: solid; }
         .desc-${type}.no-image { border-bottom-style: dashed; }`
      ).join('\n');
      s.textContent = `.description-highlight { cursor: pointer; transition: background 0.2s; }\n${rules}`;
      doc.head.appendChild(s);

      const processed = safeDescriptions.map(d => ({ data: d, patterns: preprocessDescription(d) }));
      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => n.parentElement?.classList.contains('description-highlight') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
      });

      const nodes: Text[] = [];
      let n; while ((n = walker.nextNode())) { if (n.textContent?.trim()) nodes.push(n as Text); }

      const CHUNK = 30;
      for (let i = 0; i < nodes.length; i += CHUNK) {
        const chunk = nodes.slice(i, i + CHUNK);
        await new Promise<void>(res => {
          const run = () => {
            chunk.forEach(node => {
              const text = node.textContent;
              if (!text || text.length < 15) return;
              const norm = normalizeText(text);
              for (const { data, patterns } of processed) {
                const result = findHighlightMatch(norm, patterns, norm.length);
                if (result.found && result.startIdx !== undefined && result.endIdx !== undefined) {
                  const before = text.substring(0, result.startIdx);
                  const match = text.substring(result.startIdx, result.endIdx);
                  const after = text.substring(result.endIdx);

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
                  break;
                }
              }
            });
            res();
          };
          if ('requestIdleCallback' in window) window.requestIdleCallback(run); else setTimeout(run, 0);
        });
      }
    } finally { processingRef.current = false; }
  }, [rendition, safeDescriptions, enabled, findHighlightMatch, imagesByDescId]);

  useEffect(() => {
    if (!rendition || !enabled) return;

    // iOS PWA FIX: Listen for clicks via rendition and message
    const handleClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t?.classList?.contains('description-highlight')) {
        const id = t.getAttribute('data-description-id');
        if (id) {
          e.preventDefault(); e.stopPropagation();
          const d = safeDescriptions.find(x => x.id === id);
          if (d) onDescriptionClick(d, imagesByDescId.get(id));
        }
      }
    };

    const handleMessage = (e: MessageEvent) => {
      if (e.data?.type === 'DESCRIPTION_CLICK' && e.data.id) {
        const d = safeDescriptions.find(x => x.id === e.data.id);
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
    if (safeDescriptions.length > 0 && prevCount.current === 0) {
      setTimeout(processContents, 200);
    }
    prevCount.current = safeDescriptions.length;
  }, [safeDescriptions.length, processContents]);

  return { findHighlightMatch };
};
