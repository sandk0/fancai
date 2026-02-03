import { useEffect, useCallback, useRef, useMemo } from 'react';
import type { Rendition } from '@/types/epub';
import type { Description, GeneratedImage } from '@/types/api';
import { normalizeText, removeChapterHeaders, getFirstWords } from '@/utils/text-search/normalization';
import { strategies } from '@/utils/text-search/strategies';
import { addToCache, getFromCache, type SearchPatterns } from '@/utils/text-search/cache';

interface UseDescriptionHighlightingOptions {
  rendition: Rendition | null;
  descriptions: Description[];
  images: GeneratedImage[];
  onDescriptionClick: (description: Description, image?: GeneratedImage) => void;
  enabled?: boolean;
}

const getHighlightColors = () => {
  if (typeof window === 'undefined') return { bg: 'rgba(96,165,250,0.2)', border: 'rgba(96,165,250,0.4)', active: 'rgba(96,165,250,0.5)' };
  const s = getComputedStyle(document.documentElement);
  return {
    bg: s.getPropertyValue('--highlight-bg').trim() ? `hsl(${s.getPropertyValue('--highlight-bg')})` : 'rgba(96,165,250,0.2)',
    border: s.getPropertyValue('--highlight-border').trim() ? `hsl(${s.getPropertyValue('--highlight-border')})` : 'rgba(96,165,250,0.4)',
    active: s.getPropertyValue('--highlight-active').trim() ? `hsl(${s.getPropertyValue('--highlight-active')})` : 'rgba(96,165,250,0.5)',
  };
};

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
  rendition, descriptions, images, onDescriptionClick, enabled = true,
}: UseDescriptionHighlightingOptions) => {
  const processingRef = useRef(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastProcessedIds = useRef<string>('');

  // DEFENSIVE: Ensure input is array
  const safeDescriptions = useMemo(() => Array.isArray(descriptions) ? descriptions : [], [descriptions]);
  const imagesByDescId = useMemo(() => {
    const map = new Map<string, GeneratedImage>();
    if (Array.isArray(images)) images.forEach(img => { if (img.description_id) map.set(img.description_id, img); });
    return map;
  }, [images]);

  const highlightDescription = useCallback((text: string, patterns: SearchPatterns, len: number) => {
    for (const s of strategies) { if (s.fn(text, patterns, len)) return true; }
    return false;
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

      const colors = getHighlightColors();
      const styleId = 'highlight-styles';
      if (!doc.getElementById(styleId)) {
        const s = doc.createElement('style'); s.id = styleId;
        s.textContent = `.description-highlight { background: ${colors.bg}; border-bottom: 2px solid ${colors.border}; cursor: pointer; transition: background 0.2s; } .description-highlight:hover { background: ${colors.active}; }`;
        doc.head.appendChild(s);
      }

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
                if (highlightDescription(norm, patterns, norm.length)) {
                  const span = doc.createElement('span');
                  span.className = 'description-highlight';
                  span.setAttribute('data-description-id', data.id);
                  span.textContent = text;
                  node.parentNode?.replaceChild(span, node);
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
  }, [rendition, safeDescriptions, enabled, highlightDescription]);

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

  return { highlightDescription };
};
