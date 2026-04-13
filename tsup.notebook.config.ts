import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    notebook: 'src/notebook.ts',
  },
  outDir: 'dist',
  format: ['esm'],
  outExtension: () => ({ js: '.mjs' }),
  splitting: false,
  shims: false,
  dts: false,
  // vscode-notebook-renderer 是运行时由 VS Code 注入的，不需要 bundle
  external: ['vscode'],
  loader: {
    '.css': 'text',
  },
  // highlight-plugin 和 CSS 全部内联进 notebook.mjs
  noExternal: ['./src/highlight-plugin'],
});
