import { useEffect, useCallback, useRef, useMemo } from 'react';
import type { Rendition } from '@/types/epub';
import type { EntityDetail } from '@/types/entity';
import { isEntityMetCFI } from '@/utils/entityUtils';

interface UseEntityNameHighlightingOptions {
  rendition: Rendition | null;
  entities: EntityDetail[];
  currentChapter: number;
  currentCFI?: string | null;
  enabled?: boolean;
  onEntityClick?: (entity: EntityDetail, position: { x: number; y: number }) => void;
}

const DEBOUNCE_DELAY_MS = 150;

export const useEntityNameHighlighting = ({
  rendition,
  entities,
  currentChapter,
  currentCFI,
  enabled = false,
  onEntityClick,
}: UseEntityNameHighlightingOptions) => {
  const processingRef = useRef(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastProcessedKey = useRef<string>('');

  // Only include met entities with their names + aliases
  const visibleEntities = useMemo(() => {
    if (!enabled) return [];
    return entities.filter(
      (e) => e.type === 'character' && isEntityMetCFI(e, currentCFI ?? null, currentChapter)
    );
  }, [entities, currentChapter, currentCFI, enabled]);

  // Build search terms: name + aliases, sorted longest-first for greedy matching
  const searchTerms = useMemo(() => {
    const terms: { text: string; entityId: string }[] = [];
    for (const e of visibleEntities) {
      terms.push({ text: e.name, entityId: e.id });
      if (e.aliases) {
        for (const alias of e.aliases) {
          if (alias.length >= 2) {
            terms.push({ text: alias, entityId: e.id });
          }
        }
      }
    }
    // Sort by length desc so longer names match first
    terms.sort((a, b) => b.text.length - a.text.length);
    return terms;
  }, [visibleEntities]);

  const processContents = useCallback(async () => {
    if (!rendition || !enabled || searchTerms.length === 0 || processingRef.current) return;

    const key = searchTerms.map((t) => t.entityId).join(',') + ':' + currentChapter;
    if (key === lastProcessedKey.current) return;

    try {
      const contents = rendition.getContents();
      if (!contents?.length) return;
      const doc = contents[0].document;
      if (!doc?.body) return;

      processingRef.current = true;
      lastProcessedKey.current = key;

      // Cleanup existing entity-mention spans
      const existing = doc.querySelectorAll('.entity-mention');
      existing.forEach((el) => {
        const p = el.parentNode;
        if (p) {
          p.replaceChild(doc.createTextNode(el.textContent || ''), el);
          p.normalize();
        }
      });

      // Inject styles
      const styleId = 'entity-mention-styles';
      if (!doc.getElementById(styleId)) {
        const s = doc.createElement('style');
        s.id = styleId;
        s.textContent = `.entity-mention { border-bottom: 1px dotted rgba(167,139,250,0.6); cursor: pointer; transition: background 0.2s; } .entity-mention:hover { background: rgba(167,139,250,0.15); } .entity-mention:active { background: rgba(167,139,250,0.15) !important; transition: none; }`;
        doc.head.appendChild(s);
      }

      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => {
          const parent = n.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          if (
            parent.classList.contains('entity-mention') ||
            parent.classList.contains('description-highlight')
          ) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      });

      const nodes: Text[] = [];
      let n;
      while ((n = walker.nextNode())) {
        if (n.textContent && n.textContent.trim().length >= 2) nodes.push(n as Text);
      }

      // Track matched entity IDs to only highlight first occurrence per entity
      const matchedEntities = new Set<string>();

      for (const node of nodes) {
        const text = node.textContent;
        if (!text) continue;

        for (const term of searchTerms) {
          if (matchedEntities.has(term.entityId)) continue;

          // Case-insensitive search — important for Russian text where case varies
          // (e.g. "ГАРРИ" / "гарри" should highlight entity "Гарри Поттер").
          // We search on lowercased copies but preserve the original casing in the span.
          const idx = text.toLowerCase().indexOf(term.text.toLowerCase());
          if (idx < 0) continue;

          matchedEntities.add(term.entityId);

          const before = text.substring(0, idx);
          const match = text.substring(idx, idx + term.text.length); // original casing preserved
          const after = text.substring(idx + term.text.length);

          const frag = doc.createDocumentFragment();
          if (before) frag.appendChild(doc.createTextNode(before));

          const span = doc.createElement('span');
          span.className = 'entity-mention';
          span.setAttribute('data-entity-id', term.entityId);
          span.textContent = match;
          frag.appendChild(span);

          if (after) frag.appendChild(doc.createTextNode(after));
          node.parentNode?.replaceChild(frag, node);
          break;
        }
      }
    } finally {
      processingRef.current = false;
    }
  }, [rendition, enabled, searchTerms, currentChapter]);

  useEffect(() => {
    if (!rendition || !enabled) return;

    const handleClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t?.classList?.contains('entity-mention')) {
        const id = t.getAttribute('data-entity-id');
        if (id && onEntityClick) {
          e.preventDefault();
          e.stopPropagation();
          const entity = visibleEntities.find((x) => x.id === id);
          if (entity) {
            // Compute position relative to the main viewport (accounting for iframe offset)
            const rect = t.getBoundingClientRect();
            const contents = rendition!.getContents();
            const iframe = contents?.[0]?.document?.defaultView?.frameElement as HTMLElement | null;
            const iframeRect = iframe?.getBoundingClientRect();
            const position = {
              x: (iframeRect?.left || 0) + rect.left + rect.width / 2,
              y: (iframeRect?.top || 0) + rect.bottom,
            };
            onEntityClick(entity, position);
          }
        }
      }
    };

    const handle = () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(processContents, DEBOUNCE_DELAY_MS);
    };

    rendition.on('rendered', handle);
    rendition.on('relocated', handle);
    rendition.on('click', handleClick as (e: unknown) => void);
    handle();

    return () => {
      rendition.off('rendered', handle);
      rendition.off('relocated', handle);
      rendition.off('click', handleClick as (e: unknown) => void);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [rendition, processContents, enabled, visibleEntities, onEntityClick]);

  return { processContents };
};
