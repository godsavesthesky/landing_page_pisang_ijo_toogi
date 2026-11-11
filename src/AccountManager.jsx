import { useEffect, useState } from 'react'
import { sb } from './lib.js'

const EMPTY_FORM = { nama: '', username: '', pin: '', peran: 'karyawan', cabang_id: '' }

export default function AccountManager({ say }) {
  const [accounts, setAccounts] = useState([])
  const [branches, setBranches] = useState([])
  const [form, setForm] = useState(EMPTY_FORM)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [changingAccount, setChangingAccount] = useState('')

  const load = async () => {
    setLoading(true)
    const { data, error } = await sb.functions.invoke('manage-accounts', {
      body: { action: 'list' },
    })
    setLoading(false)
    if (error) return say('Data akun gagal dimuat: ' + error.message, true)
    if (data?.error) return say(data.error, true)
    setAccounts(data.accounts || [])
    setBranches(data.branches || [])
    setForm((current) => ({
      ...current,
      cabang_id: current.cabang_id || data.branches?.find((branch) => branch.aktif)?.id || '',
    }))
  }

  useEffect(() => { load() }, [])

  const setField = (field, value) => setForm((current) => ({ ...current, [field]: value }))

  const createAccount = async (event) => {
    event.preventDefault()
    const username = form.username.trim().toLowerCase()
    if (!/^[a-z0-9._-]{3,24}$/.test(username)) {
      return say('Username harus 3–24 karakter tanpa spasi. Gunakan huruf kecil, angka, titik, _ atau -.', true)
    }

    setSaving(true)
    const { data, error } = await sb.functions.invoke('manage-accounts', {
      body: {
        action: 'create',
        nama: form.nama.trim(),
        username,
        pin: form.pin,
        peran: form.peran,
        cabang_id: form.cabang_id,
      },
    })
    setSaving(false)
    if (error) {
      let detail = error.message
      if ('context' in error && error.context instanceof Response) {
        try {
          const response = await error.context.clone().json()
          if (typeof response?.error === 'string') detail = response.error
        } catch {
          detail = error.message
        }
      }
      return say('Akun gagal dibuat: ' + detail, true)
    }
    if (data?.error) return say(data.error, true)
    setForm({ ...EMPTY_FORM, cabang_id: form.cabang_id })
    say(`Akun ${data.account.nama} berhasil dibuat.`)
    await load()
  }

  const changeAccountStatus = async (account) => {
    const action = account.aktif ? 'deactivate' : 'activate'
    const confirmation = account.aktif
      ? `Nonaktifkan akun ${account.nama}? Akun tidak bisa login lagi, tetapi riwayat transaksi dan absensinya tetap tersimpan.`
      : `Aktifkan kembali akun ${account.nama}?`
    if (!window.confirm(confirmation)) return

    setChangingAccount(account.id)
    const { data, error } = await sb.functions.invoke('manage-accounts', {
      body: { action, account_id: account.id },
    })
    setChangingAccount('')
    if (error) {
      let detail = error.message
      if ('context' in error && error.context instanceof Response) {
        try {
          const response = await error.context.clone().json()
          if (typeof response?.error === 'string') detail = response.error
        } catch {
          detail = error.message
        }
      }
      return say('Status akun gagal diubah: ' + detail, true)
    }
    if (data?.error) return say(data.error, true)
    say(account.aktif ? `Akun ${account.nama} dinonaktifkan; riwayatnya tetap tersimpan.` : `Akun ${account.nama} diaktifkan kembali.`)
    await load()
  }

  return (
    <section className="account-manager">
      <form className="box" onSubmit={createAccount}>
        <h2>Buat akun tim</h2>
        <p className="muted">Akun baru bisa langsung login dengan username dan PIN yang kamu tentukan.</p>
        <label htmlFor="account-name">Nama</label>
        <input id="account-name" required minLength={2} maxLength={80} value={form.nama} onChange={(event) => setField('nama', event.target.value)} />
        <label htmlFor="account-username">Username</label>
        <input id="account-username" required minLength={3} maxLength={24} pattern="[A-Za-z0-9._-]+" autoCapitalize="none" value={form.username} onChange={(event) => setField('username', event.target.value)} placeholder="mis. kasir1" />
        <small className="muted">Tanpa spasi, 3–24 karakter. Gunakan huruf, angka, titik, _ atau -.</small>
        <label htmlFor="account-pin">PIN login</label>
        <input id="account-pin" type="password" inputMode="numeric" autoComplete="new-password" pattern="[0-9]{6,12}" minLength={6} maxLength={12} required value={form.pin} onChange={(event) => setField('pin', event.target.value)} placeholder="6–12 angka" />
        <label htmlFor="account-role">Peran</label>
        <select id="account-role" value={form.peran} onChange={(event) => setField('peran', event.target.value)}>
          <option value="pemilik">Pemilik</option>
          <option value="karyawan">Karyawan</option>
          <option value="manager">Manager</option>
        </select>
        <label htmlFor="account-branch">Cabang</label>
        <select id="account-branch" required value={form.cabang_id} onChange={(event) => setField('cabang_id', event.target.value)}>
          <option value="">Pilih cabang</option>
          {branches.filter((branch) => branch.aktif).map((branch) => (
            <option key={branch.id} value={branch.id}>{branch.nama}</option>
          ))}
        </select>
        <button className="btn red full" type="submit" disabled={saving || !branches.some((branch) => branch.aktif)}>
          {saving ? 'Membuat akun…' : 'Buat akun'}
        </button>
        {!branches.some((branch) => branch.aktif) && <p className="err">Belum ada cabang aktif. Tambahkan cabang terlebih dahulu.</p>}
      </form>

      <section className="box">
        <h2>Akun terdaftar</h2>
        {loading ? <p className="muted">Memuat akun…</p> : accounts.length === 0
          ? <p className="muted">Belum ada profil akun.</p>
          : <div className="account-list">
            {accounts.map((account) => (
              <article className="account-row" key={account.id}>
                <div>
                  <b>{account.nama}</b>
                  <small>{account.peran} · {account.cabang?.nama || 'Tanpa cabang'}</small>
                </div>
                <div className="account-row-actions">
                  <span className={'account-status' + (account.aktif ? ' active' : '')}>{account.aktif ? 'Aktif' : 'Nonaktif'}</span>
                  {['karyawan', 'manager'].includes(String(account.peran).trim().toLowerCase()) && (
                    <button
                      className="btn alt account-status-button"
                      type="button"
                      disabled={Boolean(changingAccount)}
                      onClick={() => changeAccountStatus(account)}
                    >
                      {changingAccount === account.id
                        ? 'Menyimpan…'
                        : account.aktif ? 'Nonaktifkan' : 'Aktifkan'}
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>}
      </section>
    </section>
  )
}
