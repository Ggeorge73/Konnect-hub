import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  {
    ignores: [
      '.claude/**',
      '.next/**',
      'node_modules/**',
      'playwright-report/**',
      'test-results/**',
      'next-env.d.ts',
    ],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  // AI assist: the Anthropic SDK and API key are server-only (lib/ai/anthropic.ts imports
  // 'server-only' too). Only lib/ai/anthropic.ts may import the SDK; UI code may not import the
  // server side of lib/ai at all.
  {
    ignores: ['lib/ai/anthropic.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@anthropic-ai/sdk',
              message: 'Use lib/ai (server only): the API key must never reach the browser.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['features/**', 'components/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: '@anthropic-ai/sdk', message: 'The Anthropic SDK is server-only.' }],
          patterns: [
            {
              group: ['@/lib/ai/anthropic', '@/lib/ai/provider', '@/lib/ai/service', '**/lib/ai/anthropic'],
              message: 'AI providers are server-only: call the /api/ai routes from the UI.',
            },
          ],
        },
      ],
    },
  },
];

export default config;
