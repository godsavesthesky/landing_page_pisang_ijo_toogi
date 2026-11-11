import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' supaya hasil build bisa ditaruh di folder mana saja (mis. /app/)
export default defineConfig({ plugins: [react()], base: './' })
