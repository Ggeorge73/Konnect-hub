import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: { include: ['lib/**/*.test.ts', 'features/**/*.test.ts'], environment: 'node' },
  resolve: {
    alias: {
      '@': path.resolve(__dirname),
      'server-only': path.resolve(__dirname, 'lib/test/server-only-stub.ts'),
    },
  },
});
