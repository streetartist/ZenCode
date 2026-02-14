import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'bin/zencode': 'bin/zencode.ts',
  },
  format: ['esm'],
  target: 'node18',
  platform: 'node',
  splitting: false,
  sourcemap: true,
  clean: true,
  dts: false,
  banner: {
    js: '#!/usr/bin/env node',
  },
  // Support JSX for Ink/React TUI components
  esbuildOptions(options) {
    options.jsx = 'automatic';
  },
});
