import { createClient } from '@supabase/supabase-js'


const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  throw new Error('File .env belum diisi: VITE_SUPABASE_URL dan VITE_SUPABASE_ANON_KEY wajib ada. Setelah mengubah .env, jalankan ulang npm run dev.')
}

export const sb = createClient(url, key)
export const rp = (n) => 'Rp' + (+n || 0).toLocaleString('id-ID')
export const today = () => new Date(Date.now() + 252e5).toISOString().slice(0, 10) // tanggal WIB