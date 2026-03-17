import { describe, it, expect } from 'vitest';

describe('useTextSelection', () => {
  describe('module import', () => {
    it('imports useTextSelection without errors', async () => {
      const mod = await import('../useTextSelection');
      expect(mod.useTextSelection).toBeDefined();
      expect(typeof mod.useTextSelection).toBe('function');
    });

    it('exports suppressSelection function', async () => {
      const mod = await import('../useTextSelection');
      expect(mod.suppressSelection).toBeDefined();
      expect(typeof mod.suppressSelection).toBe('function');
    });
  });

  describe('iOS caret offset', () => {
    it('source contains IOS_CARET_OFFSET constant', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const source = fs.readFileSync(path.resolve(__dirname, '../useTextSelection.ts'), 'utf-8');
      expect(source).toContain('IOS_CARET_OFFSET');
    });

    it('source uses isIOS() in caret offset calculation', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const source = fs.readFileSync(path.resolve(__dirname, '../useTextSelection.ts'), 'utf-8');
      expect(source).toContain('isIOS()');
      expect(source).toMatch(/isIOS\(\)\s*\?\s*IOS_CARET_OFFSET/);
    });

    it('source imports isIOS from iosSupport', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const source = fs.readFileSync(path.resolve(__dirname, '../useTextSelection.ts'), 'utf-8');
      expect(source).toMatch(/import.*isIOS.*from.*iosSupport/);
    });
  });
});
