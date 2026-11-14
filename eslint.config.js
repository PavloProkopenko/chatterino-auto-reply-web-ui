import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default [
  { ignores: ['**/node_modules/**', '**/dist/**', '.tools/**', 'vendor/**', '.claude/**', 'src/server/assets.generated.ts', 'spikes/ui-svelte/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: globals.node } },
];
