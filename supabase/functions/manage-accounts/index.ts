import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: Record<string, unknown>, status = 200) => new Response(
  JSON.stringify(body),
  { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
)

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Metode request tidak didukung.' }, 405)

  const authorization = request.headers.get('Authorization')
  if (!authorization?.startsWith('Bearer ')) return json({ error: 'Silakan login sebagai pemilik.' }, 401)

  const projectUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!projectUrl || !anonKey || !serviceRoleKey) {
    console.error('Required Supabase function secrets are missing.')
    return json({ error: 'Konfigurasi fungsi akun belum lengkap.' }, 500)
  }

  const token = authorization.slice('Bearer '.length)
  const authClient = createClient(projectUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: authData, error: authError } = await authClient.auth.getUser(token)
  if (authError || !authData.user) return json({ error: 'Sesi login tidak valid. Silakan login ulang.' }, 401)

  const admin = createClient(projectUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: owner, error: ownerError } = await admin
    .from('profil')
    .select('peran,aktif')
    .eq('id', authData.user.id)
    .single()

  if (ownerError || !owner?.aktif || !['owner', 'pemilik'].includes(String(owner.peran).trim().toLowerCase())) {
    return json({ error: 'Hanya akun pemilik aktif yang boleh mengelola akun.' }, 403)
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Isi request tidak valid.' }, 400)
  }

  if (body.action === 'list') {
    const [{ data: profiles, error: profilesError }, { data: branches, error: branchesError }] = await Promise.all([
      admin.from('profil').select('id,nama,peran,cabang_id,aktif').order('nama'),
      admin.from('cabang').select('id,nama,aktif').order('nama'),
    ])
    if (profilesError || branchesError) {
      console.error('Failed to list accounts or branches:', profilesError?.message, branchesError?.message)
      return json({ error: 'Data akun atau cabang gagal dimuat.' }, 500)
    }

    const branchNames = new Map((branches || []).map((branch) => [branch.id, branch.nama]))
    return json({
      accounts: (profiles || []).map((profile) => ({
        ...profile,
        cabang: profile.cabang_id ? { nama: branchNames.get(profile.cabang_id) || null } : null,
      })),
      branches,
    })
  }

  if (body.action === 'deactivate' || body.action === 'activate') {
    const accountId = typeof body.account_id === 'string' ? body.account_id : ''
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(accountId)) {
      return json({ error: 'Pilih akun yang valid.' }, 400)
    }
    if (accountId === authData.user.id) return json({ error: 'Akun pemilik yang sedang digunakan tidak dapat diubah.' }, 400)

    const { data: target, error: targetError } = await admin
      .from('profil')
      .select('id,nama,peran,aktif')
      .eq('id', accountId)
      .maybeSingle()
    if (targetError || !target) {
      console.error('Failed to find account to change:', targetError?.message)
      return json({ error: 'Akun tidak ditemukan.' }, 404)
    }
    if (!['karyawan', 'manager'].includes(String(target.peran).trim().toLowerCase())) {
      return json({ error: 'Hanya akun karyawan atau manager yang dapat dinonaktifkan.' }, 400)
    }

    const shouldActivate = body.action === 'activate'
    if (Boolean(target.aktif) === shouldActivate) {
      return json({ error: shouldActivate ? 'Akun ini sudah aktif.' : 'Akun ini sudah nonaktif.' }, 409)
    }

    if (shouldActivate) {
      const { error: profileError } = await admin
        .from('profil')
        .update({ aktif: true })
        .eq('id', accountId)
      if (profileError) {
        console.error('Failed to reactivate account profile:', profileError.message)
        return json({ error: 'Status profil gagal diaktifkan.' }, 500)
      }

      const { error: authError } = await admin.auth.admin.updateUserById(accountId, { ban_duration: 'none' })
      if (authError) {
        const { error: rollbackError } = await admin
          .from('profil')
          .update({ aktif: false })
          .eq('id', accountId)
        if (rollbackError) console.error('Failed to roll back profile after auth reactivation failed:', rollbackError.message)
        console.error('Failed to reactivate auth account:', authError.message)
        return json({ error: 'Akses login gagal diaktifkan. Status profil dikembalikan nonaktif; coba lagi.' }, 500)
      }
    } else {
      const { error: authError } = await admin.auth.admin.updateUserById(accountId, { ban_duration: '876000h' })
      if (authError) {
        console.error('Failed to disable auth account:', authError.message)
        return json({ error: 'Akses login gagal dinonaktifkan.' }, 500)
      }

      const { error: profileError } = await admin
        .from('profil')
        .update({ aktif: false })
        .eq('id', accountId)
      if (profileError) {
        const { error: rollbackError } = await admin.auth.admin.updateUserById(accountId, { ban_duration: 'none' })
        if (rollbackError) console.error('Failed to roll back auth ban after profile update failed:', rollbackError.message)
        console.error('Failed to deactivate account profile:', profileError.message)
        return json({ error: 'Profil gagal dinonaktifkan. Perubahan akses login dibatalkan; coba lagi.' }, 500)
      }
    }

    return json({
      account: { id: target.id, nama: target.nama, aktif: shouldActivate },
    })
  }

  if (body.action !== 'create') return json({ error: 'Aksi tidak dikenal.' }, 400)

  const nama = typeof body.nama === 'string' ? body.nama.trim() : ''
  const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : ''
  const pin = typeof body.pin === 'string' ? body.pin : ''
  const peran = body.peran
  const cabangId = typeof body.cabang_id === 'string' ? body.cabang_id : ''

  if (nama.length < 2 || nama.length > 80) return json({ error: 'Nama harus berisi 2–80 karakter.' }, 400)
  if (!/^[a-z0-9._-]{3,24}$/.test(username)) return json({ error: 'Username harus 3–24 karakter: huruf, angka, titik, garis bawah, atau tanda hubung.' }, 400)
  if (!/^[0-9]{6,12}$/.test(pin)) return json({ error: 'PIN harus terdiri dari 6–12 angka.' }, 400)
  if (!['pemilik', 'manager', 'karyawan'].includes(String(peran))) return json({ error: 'Peran akun tidak valid.' }, 400)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cabangId)) {
    return json({ error: 'Pilih cabang yang valid.' }, 400)
  }

  const { data: branch, error: branchError } = await admin
    .from('cabang')
    .select('id')
    .eq('id', cabangId)
    .eq('aktif', true)
    .maybeSingle()
  if (branchError || !branch) return json({ error: 'Cabang tidak ditemukan atau sedang nonaktif.' }, 400)

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: `${username}@toogi.app`,
    password: pin,
    email_confirm: true,
  })
  if (createError || !created.user) {
    return json({ error: createError?.message || 'Akun login gagal dibuat.' }, 400)
  }

  const { error: profileError } = await admin.from('profil').insert({
    id: created.user.id,
    nama,
    peran,
    cabang_id: cabangId,
    aktif: true,
  })
  if (profileError) {
    const { error: rollbackError } = await admin.auth.admin.deleteUser(created.user.id)
    if (rollbackError) console.error('Failed to roll back auth user after profile creation failed:', rollbackError.message)
    console.error('Failed to create profile:', profileError.message)
    return json({ error: 'Profil gagal dibuat. Pastikan struktur tabel profil sesuai, lalu coba lagi.' }, 500)
  }

  return json({ account: { id: created.user.id, nama, username, peran, cabang_id: cabangId, aktif: true } }, 201)
})
