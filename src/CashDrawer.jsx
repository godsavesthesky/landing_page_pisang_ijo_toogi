import { useCallback, useEffect, useState } from 'react'
import { sb, today } from './lib.js'

const money = (value) => 'Rp' + Number(value || 0).toLocaleString('id-ID')
const MUTATION_TYPES = [
  ['setoran', 'Setor uang ke manager', 'keluar'],
  ['tambah', 'Tambah uang ke laci', 'masuk'],
  ['koreksi_masuk', 'Koreksi kas masuk', 'masuk'],
  ['koreksi_keluar', 'Koreksi kas keluar', 'keluar'],
]

export default function CashDrawer({ me, say }) {
  const [summary, setSummary] = useState(null)
  const [viewDate, setViewDate] = useState(today())
  const [loading, setLoading] = useState(true)
  const [openingAmount, setOpeningAmount] = useState('')
  const [countedAmount, setCountedAmount] = useState('')
  const [closeNote, setCloseNote] = useState('')
  const [movement, setMovement] = useState({ jenis: 'setoran', jumlah: '', catatan: '' })
  const [saving, setSaving] = useState(false)
  const load = useCallback(async () => {
    if (!me.cabang_id) return
    setLoading(true)
    const { data, error } = await sb.rpc('ringkasan_kas_laci', {
      p_cabang_id: me.cabang_id,
      p_tanggal: viewDate,
    })
    if (error) {
      say('Ringkasan kas laci gagal dimuat: ' + error.message, true)
      setLoading(false)
      return
    }
    setSummary(data)
    setLoading(false)
  }, [me.cabang_id, say, viewDate])

  useEffect(() => { load() }, [load])

  const openDrawer = async (event) => {
    event.preventDefault()
    const amount = Number(openingAmount)
    if (!Number.isSafeInteger(amount) || amount < 0) return say('Modal awal harus berupa rupiah bulat nol atau lebih.', true)
    setSaving(true)
    const { error } = await sb.rpc('kas_laci_buka', {
      p_cabang_id: me.cabang_id,
      p_saldo_awal: amount,
    })
    setSaving(false)
    if (error) return say('Kas laci gagal dibuka: ' + error.message, true)
    setOpeningAmount('')
    say('Kas laci dibuka. Penjualan cash akan tercatat otomatis.')
    await load()
  }

  const addMovement = async (event) => {
    event.preventDefault()
    const amount = Number(movement.jumlah)
    if (!Number.isSafeInteger(amount) || amount <= 0) return say('Jumlah mutasi harus berupa rupiah bulat lebih dari nol.', true)
    if (movement.catatan.trim().length < 3) return say('Isi keterangan singkat untuk mutasi kas.', true)
    setSaving(true)
    const { error } = await sb.rpc('kas_laci_mutasi_manual', {
      p_cabang_id: me.cabang_id,
      p_jenis: movement.jenis,
      p_jumlah: amount,
      p_catatan: movement.catatan.trim(),
    })
    setSaving(false)
    if (error) return say('Mutasi kas gagal dicatat: ' + error.message, true)
    setMovement((current) => ({ ...current, jumlah: '', catatan: '' }))
    say('Mutasi kas berhasil dicatat.')
    await load()
  }

  const closeDrawer = async (event) => {
    event.preventDefault()
    const amount = Number(countedAmount)
    if (!Number.isSafeInteger(amount) || amount < 0) return say('Kas fisik harus berupa rupiah bulat nol atau lebih.', true)
    if (amount !== Number(summary?.saldo_diharapkan) && closeNote.trim().length < 3) {
      return say('Isi alasan selisih kas minimal 3 karakter.', true)
    }
    setSaving(true)
    const { data, error } = await sb.rpc('kas_laci_tutup', {
      p_sesi_id: summary?.sesi?.id,
      p_saldo_fisik: amount,
      p_catatan: closeNote.trim() || null,
    })
    setSaving(false)
    if (error) return say('Kas laci gagal ditutup: ' + error.message, true)
    setCountedAmount('')
    setCloseNote('')
    say(`Kas ditutup. Selisih fisik dengan saldo seharusnya: ${money(data.selisih)}.`)
    await load()
  }

  const session = summary?.sesi
  const movements = summary?.mutasi || []
  const isClosed = Boolean(session?.ditutup_pada)
  const isToday = viewDate === today()
  const canOpen = String(me.peran).trim().toLowerCase() === 'manager'
  const typeLabel = (type) => MUTATION_TYPES.find(([value]) => value === type)?.[1]
    || ({ penjualan_cash: 'Penjualan cash', refund_cash: 'Refund cash' }[type] || type)

  return (
    <section className="cash-drawer-page">
      <div className="finance-heading">
        <div><span className="finance-eyebrow">PENGELOLAAN OUTLET</span><h1>Kas laci</h1><p>{me.cabang?.nama || 'Cabang'}</p></div>
        <div className="finance-period">
          <label htmlFor="drawer-date">Tanggal</label>
          <input id="drawer-date" type="date" max={today()} value={viewDate} onChange={(event) => setViewDate(event.target.value)} />
        </div>
      </div>
      {loading ? <div className="box"><p className="muted">Memuat kas laci…</p></div> : !session && isToday ? (
        canOpen ? <form className="box cash-drawer-open" onSubmit={openDrawer}>
          <span className="finance-eyebrow">MULAI HARI</span>
          <h2>Buka kas laci</h2>
          <p className="muted">Masukkan uang cash fisik yang tersedia sebagai modal awal. Transaksi cash tidak bisa disimpan sebelum kas dibuka.</p>
          <label htmlFor="drawer-opening">Modal awal di laci (Rp)</label>
          <input id="drawer-opening" type="number" min="0" step="1" inputMode="numeric" required value={openingAmount} onChange={(event) => setOpeningAmount(event.target.value)} placeholder="Contoh: 100000" />
          <button className="btn red full" type="submit" disabled={saving}>{saving ? 'Membuka…' : 'Buka kas laci'}</button>
        </form> : <div className="box cash-drawer-open"><h2>Kas laci belum dibuka</h2><p className="muted">Minta manager cabang menetapkan modal awal kas sebelum transaksi cash dimulai.</p></div>
      ) : session ? (
        <>
          <section className="box cash-drawer-summary">
            <div className="cash-drawer-summary-heading">
              <div><span className="finance-eyebrow">{isClosed ? 'HARI SELESAI' : 'KAS HARI INI'}</span><h2>{isClosed ? 'Kas laci ditutup' : 'Kas laci sedang dibuka'}</h2></div>
              <span className={`account-status${isClosed ? '' : ' active'}`}>{isClosed ? 'Ditutup' : 'Aktif'}</span>
            </div>
            <div className="cash-drawer-totals">
              <article><small>Modal awal</small><b>{money(session.saldo_awal)}</b></article>
              <article><small>Saldo seharusnya</small><b>{money(summary.saldo_diharapkan)}</b></article>
              {isClosed && <article><small>Selisih tutup</small><b>{money(summary.selisih)}</b></article>}
            </div>
            {isClosed && <p className="muted">Kas fisik saat tutup: {money(session.saldo_fisik_tutup)}</p>}
            {!isClosed && isToday && (
              <p className="muted">Penjualan cash menambah saldo otomatis. Setoran ke manager mengurangi kas laci dan dicatat terpisah dari pengeluaran operasional.</p>
            )}
          </section>

          {!isClosed && (
            <>
              {isToday && <form className="box cash-drawer-movement" onSubmit={addMovement}>
                <h2>Setoran atau koreksi kas</h2>
                <div className="row2">
                  <div><label htmlFor="drawer-movement-type">Jenis</label><select id="drawer-movement-type" value={movement.jenis} onChange={(event) => setMovement((current) => ({ ...current, jenis: event.target.value }))}>{MUTATION_TYPES.map(([value, label, direction]) => <option key={value} value={value}>{label}{value !== 'setoran' ? ` (${direction})` : ''}</option>)}</select></div>
                  <div><label htmlFor="drawer-movement-amount">Jumlah (Rp)</label><input id="drawer-movement-amount" type="number" min="1" step="1" required value={movement.jumlah} onChange={(event) => setMovement((current) => ({ ...current, jumlah: event.target.value }))} /></div>
                </div>
                <label htmlFor="drawer-movement-note">Keterangan</label>
                <input id="drawer-movement-note" required minLength="3" maxLength="160" value={movement.catatan} onChange={(event) => setMovement((current) => ({ ...current, catatan: event.target.value }))} placeholder="Contoh: setoran ke manager" />
                <button className="btn full" type="submit" disabled={saving}>{saving ? 'Menyimpan…' : 'Catat mutasi kas'}</button>
              </form>}
              <form className="box cash-drawer-close" onSubmit={closeDrawer}>
                <h2>Tutup kas saat closing</h2>
                <p className="muted">Hitung uang cash fisik di laci, lalu catat jumlah sebenarnya. Sistem menampilkan selisih untuk ditinjau.</p>
                <label htmlFor="drawer-counted">Kas fisik saat ini (Rp)</label>
                <input id="drawer-counted" type="number" min="0" step="1" required value={countedAmount} onChange={(event) => setCountedAmount(event.target.value)} />
                <label htmlFor="drawer-close-note">Catatan selisih <span className="inventory-optional">(wajib jika jumlah berbeda)</span></label>
                <input id="drawer-close-note" maxLength="160" value={closeNote} onChange={(event) => setCloseNote(event.target.value)} placeholder="Contoh: ada uang kembalian kurang" />
                <button className="btn red full" type="submit" disabled={saving}>{saving ? 'Menutup…' : 'Tutup kas laci'}</button>
              </form>
            </>
          )}

          <section className="box cash-drawer-history">
            <h2>Riwayat kas hari ini</h2>
            {movements.map((entry) => (
              <article className="cash-drawer-history-row" key={entry.id}>
                <div><b>{typeLabel(entry.jenis)}</b><small>{entry.catatan || 'Dicatat otomatis'} · {new Date(entry.dibuat_pada).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' })}</small></div>
                <strong className={entry.arah === 'masuk' ? 'inventory-positive' : 'inventory-negative'}>{entry.arah === 'masuk' ? '+' : '−'}{money(entry.jumlah)}</strong>
              </article>
            ))}
            {!movements.length && <p className="muted">Belum ada mutasi kas.</p>}
          </section>
        </>
      ) : <div className="box"><p className="muted">Belum ada sesi kas laci pada tanggal ini.</p></div>}
    </section>
  )
}
