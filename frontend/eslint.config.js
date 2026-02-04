import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      'dist/**',
      'build/**',
      '.vite/**',
      'node_modules/**',
      'scripts/**',
      'src/sw.ts',
      'vite.config.ts',
      'vitest.config.ts',
      'tailwind.config.js',
      'postcss.config.js',
      'tests/**',
      '**/*.spec.ts',
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/*.d.ts',
      'vite.config.ts.timestamp-*',
    ],
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.es2020,
      },
      parserOptions: {
        project: './tsconfig.json',
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // New rules in react-hooks v7 — demote to warnings for gradual adoption
      // These are React Compiler compatibility rules that require significant refactoring
      'react-hooks/set-state-in-effect': 'warn',    // setState in useEffect (common pattern)
      'react-hooks/refs': 'warn',                    // ref access during render
      'react-hooks/purity': 'warn',                  // impure function calls in render
      'react-hooks/use-memo': 'warn',                // non-inline useCallback arguments
      'react-hooks/immutability': 'warn',            // prop/argument mutation
      'react-hooks/incompatible-library': 'off',     // third-party library warnings (noise)
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      '@typescript-eslint/no-explicit-any': [
        'warn',
        { ignoreRestArgs: true },
      ],
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-var-requires': 'warn',
      'prefer-const': 'warn',
      'no-console': 'off',
    },
  },
);
