import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Относительный путь работает и в project pages, и на custom domain.
  base: './',
})
