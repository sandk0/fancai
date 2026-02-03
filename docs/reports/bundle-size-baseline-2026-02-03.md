# Bundle Size Baseline — 03 февраля 2026

## Сводка

| Метрика | Значение |
|---------|----------|
| Общий размер dist/ | 3.2 MB |
| JS (uncompressed) | 1,802 KB (1.76 MB) |
| JS (gzipped) | 550 KB |
| CSS (uncompressed) | 99 KB |
| CSS (gzipped) | 17 KB |
| Largest JS chunk | index-JBwMabl1.js — 636 KB |
| 2nd largest JS chunk | BookReaderPage-B3TnSQmS.js — 484 KB |
| Общий JS + CSS (gzipped) | ~567 KB |

## Chunks (JS)

| Файл | Размер | gzip |
|------|--------|------|
| index-JBwMabl1.js | 636.5 KB | 192.9 KB |
| BookReaderPage-B3TnSQmS.js | 483.8 KB | 146.7 KB |
| vendor-ui-Cj4N7Snk.js | 147.9 KB | 44.3 KB |
| vendor-radix-C0SCBmVQ.js | 83.0 KB | 28.5 KB |
| vendor-forms-Dqtpufp7.js | 77.9 KB | 21.4 KB |
| vendor-data-w_bQLQFv.js | 74.6 KB | 25.9 KB |
| SettingsPage-BLZ3gQ-W.js | 68.3 KB | 16.9 KB |
| EntityProfile-CT3MbhPU.js | 42.6 KB | 13.6 KB |
| vendor-router-DEL4VaXB.js | 35.1 KB | 12.8 KB |
| vendor-utils-DlH5yEYx.js | 36.6 KB | 12.6 KB |
| AdminDashboardEnhanced-zLj9UjHq.js | 22.6 KB | 6.2 KB |
| BookImagesPage-C52ZHyhe.js | 14.7 KB | 4.4 KB |
| ImagesGalleryPage-D9PItFBj.js | 13.1 KB | 3.6 KB |
| StatsPage-IspoYnHz.js | 11.8 KB | 2.9 KB |
| vendor-react-uS-d4TUT.js | 11.6 KB | 4.1 KB |
| ProfilePage-D5WAJ2b9.js | 9.5 KB | 2.6 KB |
| ImageModal-vkJQfSu3.js | 8.5 KB | 2.7 KB |
| BookPage-BH22tEDa.js | 8.0 KB | 2.3 KB |
| BookGalleryPage-CUItLUt9.js | 6.5 KB | 2.3 KB |
| workbox-window.prod.es5-BIl4cyR9.js | 5.6 KB | 2.3 KB |
| Accordion-CKLSdlUf.js | 2.0 KB | 0.9 KB |
| ErrorMessage-mBGJc96B.js | 1.7 KB | 0.7 KB |

## Chunks (CSS)

| Файл | Размер | gzip |
|------|--------|------|
| index-DiuYME0Q.css | 98.6 KB | 17.2 KB |

## Service Worker

| Файл | Размер | gzip |
|------|--------|------|
| sw.mjs (source) | 40.1 KB | 12.0 KB |
| Precache entries | 29 | 1,924 KB total |

## CI Check

- **Script:** `frontend/scripts/check-bundle-size.js`
- **Status:** BUG — script reports 0 KB JS
- **Root cause:** Script scans `dist/assets/` for `.js` files, but Vite outputs JS to `dist/assets/js/` subdirectory. Only CSS is found at `dist/assets/` level.
- **Limits configured:**
  - Single chunk warning: 500 KB
  - Gzip total target: 500 KB
  - Raw total target: 800 KB
- **Actual output:**
  ```
  📦 JavaScript Chunks:
  (empty — no JS files found)

  📄 CSS Files:
    ✅     98.62 KB  index-DiuYME0Q.css

  📈 Summary:
    Total JS:              0.00 KB
    Total CSS:             98.62 KB
    Total (raw):           98.62 KB
    Estimated gzipped:     29.59 KB

  ✅ Bundle size within targets! 🎉
  ```
- **Fix needed:** Update `distDir` in the script to also scan `dist/assets/js/`, or recursively scan subdirectories.

## Vite Build Warnings

- `index-JBwMabl1.js` (636 KB) exceeds Vite's 600 KB `chunkSizeWarningLimit`
- `auth.ts` is both dynamically and statically imported (won't be split into separate chunk)

## TypeScript Check

- **Command:** `tsc --noEmit`
- **Errors:** 2 (pre-existing)
  - `src/components/Reader/TocSidebar.tsx(1,55)`: TS6133 — `useCallback` declared but never read
  - `src/components/Reader/TocSidebar.tsx(5,1)`: TS6133 — `useVirtualizer` declared but never read

## Ключевые наблюдения

1. **README заявляет 386 KB gzipped** — фактически **567 KB gzipped** (JS + CSS). Расхождение ~47%.
2. **Два огромных чанка** — `index` (636 KB) и `BookReaderPage` (484 KB) составляют 60% всего JS.
3. **CI-скрипт не работает** — из-за изменённой структуры `dist/assets/js/` не находит JS-файлы.
4. **Vendor chunks хорошо разделены** — radix, forms, data, router, utils отдельно.
5. **Потенциал оптимизации** — `index` бандл слишком большой, нужен code-splitting.
