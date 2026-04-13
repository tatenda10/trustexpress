import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import BASE_URL from './src/context/Api'
// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    allowedHosts: ['.ngrok-free.app'],
    proxy: {
      '/api': {
        target: BASE_URL,
        changeOrigin: true,
      },
      '/uploads': {
        target: BASE_URL,
        changeOrigin: true,
      },
    },
  },
})
