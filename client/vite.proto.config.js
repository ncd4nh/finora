// Build bản prototype 1 trang (chạy toàn bộ trong trình duyệt): npm run build:proto
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const ext = (f) => fileURLToPath(new URL(`./src/mock/ext/${f}`, import.meta.url));

export default defineConfig({
  plugins: [react()],
  define: { 'import.meta.env.VITE_MOCK': '"1"' },
  resolve: {
    alias: [
      { find: /^react$/, replacement: ext('react.js') },
      { find: /^react\/jsx(-dev)?-runtime$/, replacement: ext('jsx-runtime.js') },
      { find: /^react-dom\/client$/, replacement: ext('react-dom-client.js') },
      { find: /^react-dom$/, replacement: ext('react-dom.js') },
      { find: /^recharts$/, replacement: ext('recharts.js') },
      { find: /^better-sqlite3$/, replacement: ext('sqlite.js') },
      { find: /^express$/, replacement: ext('express.js') },
      { find: /^@anthropic-ai\/sdk$/, replacement: ext('anthropic.js') },
      { find: /^node:(fs|path)$/, replacement: ext('node-stubs.js') },
      { find: /^node:async_hooks$/, replacement: ext('async-hooks.js') },
      { find: /^\.\/security\.js$/, replacement: ext('security.js') },
      { find: /^\.\/mailer\.js$/, replacement: ext('mailer.js') },
    ],
  },
  build: {
    outDir: 'dist-proto',
    emptyOutDir: true,
    target: 'esnext',
    modulePreload: false,
    assetsInlineLimit: 100_000_000, // nhúng logo dạng data URI
    cssCodeSplit: false,
    rollupOptions: { input: 'proto.html', output: { inlineDynamicImports: true } },
  },
});
