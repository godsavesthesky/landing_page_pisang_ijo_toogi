import { useCallback, useEffect, useState } from 'react'
import { sb } from './lib.js'

const EMPTY_BRANCH = { nama: '', alamat: '', lat: '', lng: '', radius_m: '200' }

const toDraft = (branch) => ({
  nama: branch.nama || '',
  alamat: branch.alamat || '',
  lat: branch.lat == null ? '' : String(branch.lat),
  lng: branch.lng == null ? '' : String(branch.lng),
  radius_m: String(branch.radius_m || 200),
  aktif: Boolean(branch.aktif),
})

export default function BranchManager({ say }) {
  const [branches, setBranches] = useState([])
  const [managers, setManagers] = useState([])
  const [assignments, setAssignments] = useState({})
  const [drafts, setDrafts] = useState({})
  const [form, setForm] = useState(EMPTY_BRANCH)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data, error }, { data: branchRows, error: branchError }, { data: assignmentRows, error: assignmentError }] = await Promise.all([
      sb.functions.invoke('manage-accounts', { body: { action: 'list' } }),
      sb.rpc('kelola_cabang_daftar'),
      sb.from('manager_cabang').select('manager_id,cabang_id'),
    ])
    setLoading(false)
    if (error || data?.error || branchError || assignmentError) {
      say('Data cabang gagal dimuat: ' + (data?.error || error?.message || branchError?.message || assignmentError?.message), true)
      return
    }
    setBranches(branchRows || [])
    setManagers((data.accounts || []).filter((account) => account.aktif && String(account.peran).toLowerCase() === 'manager'))
    setDrafts(Object.fromEntries((branchRows || []).map((branch) => [branch.id, toDraft(branch)])))
    const nextAssignments = {}
    for (const assignment of assignmentRows || []) {
      nextAssignments[assignment.cabang_id] ||= []
      nextAssignments[assignment.cabang_id].push(assignment.manager_id)
    }
    setAssignments(nextAssignments)
  }, [say])

  useEffect(() => { load() }, [load])

  const createBranch = async (event) => {
    event.preventDefault()
    const lat = Number(form.lat)
    const lng = Number(form.lng)
    const radius = Number(form.radius_m)
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      return say('Masukkan koordinat latitude dan longitude yang valid.', true)
    }
    if (!Number.isInteger(radius) || radius < 25 || radius > 5000) return say('Radius absensi harus 25–5.000 meter.', true)
    setSaving('create')
    const { error } = await sb.rpc('buat_cabang', {
      p_nama: form.nama.trim(),
      p_alamat: form.alamat.trim() || null,
      p_lat: lat,
      p_lng: lng,
      p_radius_m: radius,
    })
    setSaving('')
    if (error) return say('Cabang gagal dibuat: ' + error.message, true)
    setForm(EMPTY_BRANCH)
    say('Cabang berhasil dibuat. Harga mengikuti harga awal katalog; stok awal masih nol dan perlu dicatat karyawan.')
    await load()
  }

  const saveBranch = async (branch) => {
    const draft = drafts[branch.id]
    const lat = Number(draft.lat)
    const lng = Number(draft.lng)
    const radius = Number(draft.radius_m)
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      return say(`Koordinat cabang ${branch.nama} tidak valid.`, true)
    }
    if (!Number.isInteger(radius) || radius < 25 || radius > 5000) return say('Radius absensi harus 25–5.000 meter.', true)
    setSaving(branch.id)
    const { error } = await sb.rpc('ubah_cabang', {
      p_cabang_id: branch.id,
      p_nama: draft.nama.trim(),
      p_alamat: draft.alamat.trim() || null,
      p_lat: lat,
      p_lng: lng,
      p_radius_m: radius,
      p_aktif: draft.aktif,
    })
    setSaving('')
    if (error) return say('Perubahan cabang gagal disimpan: ' + error.message, true)
    say(`Cabang ${draft.nama} berhasil diperbarui.`)
    await load()
  }

  const saveManagers = async (branch) => {
    setSaving(`manager-${branch.id}`)
    const { error } = await sb.rpc('atur_manager_cabang', {
      p_cabang_id: branch.id,
      p_manager_ids: assignments[branch.id] || [],
    })
    setSaving('')
    if (error) return say('Penugasan manager gagal disimpan: ' + error.message, true)
    say(`Penugasan manager untuk ${branch.nama} berhasil diperbarui.`)
    await load()
  }

  const changeDraft = (branchId, key, value) => {
    setDrafts((current) => ({ ...current, [branchId]: { ...current[branchId], [key]: value } }))
  }

  const toggleManager = (branchId, managerId) => {
    setAssignments((current) => {
      const selected = current[branchId] || []
      return {
        ...current,
        [branchId]: selected.includes(managerId)
          ? selected.filter((id) => id !== managerId)
          : [...selected, managerId],
      }
    })
  }

  return (
    <section className="branch-manager">
      <div className="finance-heading">
        <div>
          <span className="finance-eyebrow">OPERASIONAL TOKO</span>
          <h1>Kelola cabang</h1>
          <p>Atur lokasi absensi, radius, status cabang, dan manager yang bertugas.</p>
        </div>
      </div>
      <form className="box branch-create-form" onSubmit={createBranch}>
        <h2>Tambah cabang</h2>
        <p className="muted">Koordinat bisa diambil dari pin lokasi di Google Maps. Contoh: -7.93 dan 112.63.</p>
        <label htmlFor="branch-new-name">Nama cabang</label>
        <input id="branch-new-name" required minLength="2" maxLength="100" value={form.nama} onChange={(event) => setForm((current) => ({ ...current, nama: event.target.value }))} placeholder="Contoh: Cabang Malang" />
        <label htmlFor="branch-new-address">Alamat (opsional)</label>
        <input id="branch-new-address" maxLength="240" value={form.alamat} onChange={(event) => setForm((current) => ({ ...current, alamat: event.target.value }))} />
        <div className="branch-coordinates">
          <div><label htmlFor="branch-new-lat">Latitude</label><input id="branch-new-lat" required type="number" step="any" min="-90" max="90" value={form.lat} onChange={(event) => setForm((current) => ({ ...current, lat: event.target.value }))} placeholder="-7.9338" /></div>
          <div><label htmlFor="branch-new-lng">Longitude</label><input id="branch-new-lng" required type="number" step="any" min="-180" max="180" value={form.lng} onChange={(event) => setForm((current) => ({ ...current, lng: event.target.value }))} placeholder="112.6374" /></div>
          <div><label htmlFor="branch-new-radius">Radius absensi (meter)</label><input id="branch-new-radius" required type="number" min="25" max="5000" step="1" value={form.radius_m} onChange={(event) => setForm((current) => ({ ...current, radius_m: event.target.value }))} /></div>
        </div>
        <button className="btn red full" type="submit" disabled={saving === 'create'}>{saving === 'create' ? 'Membuat cabang…' : 'Simpan cabang'}</button>
      </form>

      <div className="branch-admin-list">
        {loading ? <div className="box"><p className="muted">Memuat cabang…</p></div> : branches.map((branch) => {
          const draft = drafts[branch.id] || toDraft(branch)
          const selectedManagers = assignments[branch.id] || []
          return (
            <article className="box branch-admin-card" key={branch.id}>
              <div className="branch-admin-title">
                <div><span className="finance-eyebrow">CABANG</span><h2>{branch.nama}</h2></div>
                <span className={`account-status${draft.aktif ? ' active' : ''}`}>{draft.aktif ? 'Aktif' : 'Nonaktif'}</span>
              </div>
              <label htmlFor={`branch-name-${branch.id}`}>Nama cabang</label>
              <input id={`branch-name-${branch.id}`} maxLength="100" value={draft.nama} onChange={(event) => changeDraft(branch.id, 'nama', event.target.value)} />
              <label htmlFor={`branch-address-${branch.id}`}>Alamat</label>
              <input id={`branch-address-${branch.id}`} maxLength="240" value={draft.alamat} onChange={(event) => changeDraft(branch.id, 'alamat', event.target.value)} />
              <div className="branch-coordinates">
                <div><label htmlFor={`branch-lat-${branch.id}`}>Latitude</label><input id={`branch-lat-${branch.id}`} type="number" step="any" value={draft.lat} onChange={(event) => changeDraft(branch.id, 'lat', event.target.value)} /></div>
                <div><label htmlFor={`branch-lng-${branch.id}`}>Longitude</label><input id={`branch-lng-${branch.id}`} type="number" step="any" value={draft.lng} onChange={(event) => changeDraft(branch.id, 'lng', event.target.value)} /></div>
                <div><label htmlFor={`branch-radius-${branch.id}`}>Radius (meter)</label><input id={`branch-radius-${branch.id}`} type="number" min="25" max="5000" step="1" value={draft.radius_m} onChange={(event) => changeDraft(branch.id, 'radius_m', event.target.value)} /></div>
              </div>
              <label className="branch-active-toggle"><input type="checkbox" checked={draft.aktif} onChange={(event) => changeDraft(branch.id, 'aktif', event.target.checked)} /> Cabang aktif</label>
              <button className="btn red full" type="button" disabled={saving === branch.id} onClick={() => saveBranch(branch)}>{saving === branch.id ? 'Menyimpan…' : 'Simpan detail cabang'}</button>

              <div className="branch-manager-assignment">
                <h3>Manager cabang</h3>
                {!managers.length ? <p className="muted">Belum ada akun manager aktif.</p> : managers.map((manager) => (
                  <label className="branch-manager-option" key={manager.id}>
                    <input type="checkbox" checked={selectedManagers.includes(manager.id)} onChange={() => toggleManager(branch.id, manager.id)} />
                    <span>{manager.nama}</span>
                  </label>
                ))}
                <button className="btn full" type="button" disabled={saving === `manager-${branch.id}`} onClick={() => saveManagers(branch)}>
                  {saving === `manager-${branch.id}` ? 'Menyimpan…' : 'Simpan penugasan manager'}
                </button>
              </div>
              <p className="branch-seed-note">Harga awal disalin dari katalog yang ada. Stok produk dan bahan di cabang baru mulai dari nol; isi stok fisik sebelum operasional.</p>
            </article>
          )
        })}
        {!loading && !branches.length && <p className="box muted">Belum ada cabang.</p>}
      </div>
    </section>
  )
}
