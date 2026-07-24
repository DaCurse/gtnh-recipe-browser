import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import svelte from 'eslint-plugin-svelte';
import ts from 'typescript-eslint';

export default defineConfig(
  globalIgnores([
    'dist/**',
    'node_modules/**',
    'public/data/**',
    'tests/fixtures/**',
    'gtnh@ShadowTheAge/**'
  ]),
  js.configs.recommended,
  ts.configs.recommended,
  svelte.configs.recommended,
  {
    files: ['src/**/*.{ts,svelte}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.worker
      }
    }
  },
  {
    files: ['tools/**/*.{ts,mjs}', 'tests/**/*.ts', '*.{ts,js}'],
    languageOptions: {
      globals: globals.node
    }
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: {
      parserOptions: {
        extraFileExtensions: ['.svelte'],
        parser: ts.parser
      }
    },
    rules: {
      'svelte/prefer-svelte-reactivity': 'off'
    }
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off'
    }
  }
);
