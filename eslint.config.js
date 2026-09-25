import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', '.cache/'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  {
    // In tests a wrong assumption should crash the test, which is what `!` does.
    files: ['**/*.test.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
  {
    // core/ holds every truth-critical pure function. It must stay renderer-free,
    // so it can be tested in Node and survive three.js upgrades untouched.
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['three', 'three/*'],
              message: 'core/ must not depend on three.js. Keep it pure TypeScript.',
            },
          ],
        },
      ],
    },
  },
);
