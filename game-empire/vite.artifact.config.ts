// Build for the hosted Artifact page: libraries stay external and are loaded
// from the CDN by the page (see scripts/build-artifact.mjs); only this
// project's own code is bundled, unminified.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export const EXTERNALS = ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', 'recharts', 'zustand', 'lucide-react'];

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  build: {
    outDir: 'dist-artifact/build',
    emptyOutDir: true,
    minify: false,
    cssCodeSplit: false,
    modulePreload: false,
    rollupOptions: {
      external: EXTERNALS,
      output: { format: 'es', entryFileNames: 'app.js', assetFileNames: 'app[extname]' },
    },
  },
});
