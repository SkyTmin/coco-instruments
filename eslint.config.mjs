import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

// Focused on catching real bugs (Rules of Hooks, undefined vars), not style.
export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'legacy', 'icons', 'public', '**/*.config.*'] },
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
  prettier,
);
