import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

// Focused on catching real bugs (Rules of Hooks, undefined vars), not style.
export default tseslint.config(
  {
    ignores: [
      'dist',
      'node_modules',
      'legacy',
      'icons',
      'public',
      '**/*.config.*',
      // Рабочие копии агентов (git worktree) — не часть проекта.
      '.claude',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
      'no-empty': 'off',
    },
  },
  {
    files: ['server.js', 'app.js', 'tests/**/*.js'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      'no-empty': 'off',
    },
  },
  {
    // Инструменты стенда: node-скрипты, которые гоняют страницу в браузере
    // (`page.evaluate` видит window/document), и рисовалки питомцев в
    // браузере (`FILM` — общий объект плёнки). Ловим неизвестные имена,
    // стиль не держим.
    files: ['scripts/**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser, FILM: 'readonly' },
    },
    rules: {
      'no-empty': 'off',
      'no-useless-escape': 'warn',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-vars': 'warn',
      '@typescript-eslint/no-unused-expressions': 'warn',
    },
  },
  prettier,
);
