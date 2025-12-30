import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ command }) => {
  return {
    plugins: [react()],
    // Establece la base condicionalmente
    // Si el comando es 'serve' (desarrollo), la base es '/'
    // Si el comando es 'build' (producción), la base es '/chat-de-voz/'
    base: command === 'serve' ? '/' : '/chat-de-voz/',
  }
})
