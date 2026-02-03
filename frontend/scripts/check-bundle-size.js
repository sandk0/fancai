#!/usr/bin/env node

/**
 * Bundle Size Checker
 *
 * Analyzes the build output and reports bundle sizes.
 * Warns if any chunk exceeds the configured limits.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const distDir = path.join(__dirname, '..', 'dist', 'assets');
const jsDir = path.join(distDir, 'js');

// Size limits (in KB)
const LIMITS = {
  chunk: 500,      // Warning threshold for any single chunk
  gzipTotal: 500,  // Target for total gzipped size
  rawTotal: 800,   // Target for total raw size
};

function getFileSizeInKB(filepath) {
  const stats = fs.statSync(filepath);
  return stats.size / 1024;
}

function formatSize(kb) {
  return kb >= 1024
    ? `${(kb / 1024).toFixed(2)} MB`
    : `${kb.toFixed(2)} KB`;
}

function analyzeBundle() {
  console.log('\n📊 Bundle Size Analysis\n');
  console.log('═'.repeat(70));

  if (!fs.existsSync(distDir)) {
    console.error('❌ Dist directory not found. Run build first.');
    process.exit(1);
  }

  // JS files are in dist/assets/js/ subdirectory
  const jsFiles = fs.existsSync(jsDir) 
    ? fs.readdirSync(jsDir).filter(f => f.endsWith('.js'))
    : [];
  
  // CSS files are directly in dist/assets/
  const cssFiles = fs.readdirSync(distDir).filter(f => f.endsWith('.css'));

  let totalJsSize = 0;
  let totalCssSize = 0;
  let warnings = [];

  console.log('\n📦 JavaScript Chunks:\n');

  jsFiles
    .map(file => ({
      name: file,
      size: getFileSizeInKB(path.join(jsDir, file))
    }))
    .sort((a, b) => b.size - a.size)
    .forEach(({ name, size }) => {
      totalJsSize += size;
      const sizeStr = formatSize(size).padStart(12);
      const indicator = size > LIMITS.chunk ? '⚠️ ' : '✅';

      console.log(`  ${indicator} ${sizeStr}  ${name}`);

      if (size > LIMITS.chunk) {
        warnings.push(`${name} exceeds ${LIMITS.chunk}KB limit (${formatSize(size)})`);
      }
    });

  console.log('\n📄 CSS Files:\n');

  cssFiles
    .map(file => ({
      name: file,
      size: getFileSizeInKB(path.join(distDir, file))
    }))
    .sort((a, b) => b.size - a.size)
    .forEach(({ name, size }) => {
      totalCssSize += size;
      const sizeStr = formatSize(size).padStart(12);
      console.log(`  ✅ ${sizeStr}  ${name}`);
    });

  const totalSize = totalJsSize + totalCssSize;
  const estimatedGzipSize = totalSize * 0.3; // Rough estimate: ~30% of raw size

  console.log('\n' + '═'.repeat(70));
  console.log('\n📈 Summary:\n');
  console.log(`  Total JS:              ${formatSize(totalJsSize)}`);
  console.log(`  Total CSS:             ${formatSize(totalCssSize)}`);
  console.log(`  Total (raw):           ${formatSize(totalSize)}`);
  console.log(`  Estimated gzipped:     ${formatSize(estimatedGzipSize)}`);

  console.log('\n🎯 Targets:\n');
  console.log(`  Raw size target:       ${formatSize(LIMITS.rawTotal)}`);
  console.log(`  Gzipped target:        ${formatSize(LIMITS.gzipTotal)}`);

  console.log('\n' + '═'.repeat(70));

  // Check against targets
  const rawStatus = totalSize <= LIMITS.rawTotal ? '✅' : '⚠️';
  const gzipStatus = estimatedGzipSize <= LIMITS.gzipTotal ? '✅' : '⚠️';

  console.log(`\n${rawStatus} Raw size: ${formatSize(totalSize)} / ${formatSize(LIMITS.rawTotal)}`);
  console.log(`${gzipStatus} Gzipped: ${formatSize(estimatedGzipSize)} / ${formatSize(LIMITS.gzipTotal)}`);

  if (warnings.length > 0) {
    console.log('\n⚠️  Warnings:\n');
    warnings.forEach(w => console.log(`  - ${w}`));
  }

  if (totalSize > LIMITS.rawTotal || estimatedGzipSize > LIMITS.gzipTotal) {
    console.log('\n⚠️  Bundle size exceeds targets. Consider:');
    console.log('  - Adding more code splitting');
    console.log('  - Lazy loading heavy components');
    console.log('  - Removing unused dependencies');
    console.log('  - Using lighter alternatives');
    console.log('\n  Run `npm run build:analyze` to see detailed breakdown');
  } else {
    console.log('\n✅ Bundle size within targets! 🎉');
  }

  console.log('\n');
}

analyzeBundle();
