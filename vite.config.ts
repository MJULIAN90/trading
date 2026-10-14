import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  root: 'client',
  build: { outDir: '../web', emptyOutDir: true },
  server: {
    port: 5173,
    // En desarrollo el front vive en 5173 y la API en 4321; en produccion la
    // propia API sirve el build, asi que las rutas relativas valen para ambos.
    proxy: { '/api': 'http://127.0.0.1:4321' },
  },
});
