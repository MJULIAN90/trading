import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  root: 'client/preview',
  base: './',
  build: { outDir: '../../preview-out', emptyOutDir: true, minify: false, sourcemap: false },
});
