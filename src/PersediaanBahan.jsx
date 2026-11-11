import { useCallback, useEffect, useMemo, useState } from 'react'
import { sb } from './lib.js'

const formatNumber = (value) => Number(value || 0).toLocaleString('id-ID', { maximumFractionDigits: 3 })
const formatDateTime = (value) => new Date(value).toLocaleString('id-ID', {
  timeZone: 'Asia/Jakarta',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

export default function PersediaanBahan({ me, say }) {
  const [materials, setMaterials] = useState([])
  const [balances, setBalances] = useState({})
  const [history, setHistory] = useState([])
  const [recorderNames, setRecorderNames] = useState({})
  const [search, setSearch] = useState('')
  const [operation, setOperation] = useState(null)
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const isEmployee = String(me.peran).trim().toLowerCase() === 'karyawan'

  const load = useCallback(async () => {
    setLoading(true)
    const [materialResult, balanceResult, historyResult] = await Promise.all([
      sb.from('bahan_persediaan').select('id,nama,satuan').eq('aktif', true).order('nama'),
      sb.from('saldo_persediaan_bahan').select('bahan_id,jumlah').eq('cabang_id', me.cabang_id),
      sb.from('mutasi_persediaan_bahan')
        .select('id,bahan_id,jenis,jumlah,catatan,dicatat_oleh,dibuat_pada')
        .eq('cabang_id', me.cabang_id)
        .order('dibuat_pada', { ascending: false })
        .limit(15),
    ])
    const failed = [materialResult, balanceResult, historyResult].find((result) => result.error)
    if (failed) {
      say('Persediaan bahan baku gagal dimuat. Pastikan migrasi persediaan bahan sudah dijalankan: ' + failed.error.message, true)
      setLoading(false)
      return
    }
    const recorderIds = [...new Set((historyResult.data || []).map((row) => row.dicatat_oleh))]
    const recorderResult = recorderIds.length
      ? await sb.from('profil').select('id,nama').in('id', recorderIds)
      : { data: [], error: null }
    if (recorderResult.error) say('Nama pencatat belum dapat ditampilkan: ' + recorderResult.error.message, true)
    setMaterials(materialResult.data || [])
    setBalances(Object.fromEntries((balanceResult.data || []).map((row) => [row.bahan_id, Number(row.jumlah)])))
    setHistory(historyResult.data || [])
    setRecorderNames(Object.fromEntries((recorderResult.data || []).map((row) => [row.id, row.nama])))
    setLoading(false)
  }, [me.cabang_id, say])

  useEffect(() => { load() }, [load])

  const visibleMaterials = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase('id')
    return materials.filter((material) => material.nama.toLocaleLowerCase('id').includes(normalized))
  }, [materials, search])

  const beginOperation = (material, jenis) => {
    setOperation({ material, jenis })
    setAmount('')
    setNote('')
  }

  const submitOperation = async (event) => {
    event.preventDefault()
    const quantity = Number(amount)
    if (!operation || !Number.isFinite(quantity) || quantity <= 0) {
      return say('Masukkan jumlah lebih dari nol.', true)
    }
    if (operation.material.satuan !== 'ltr' && !Number.isInteger(quantity)) {
      return say(`Jumlah ${operation.material.satuan} harus berupa bilangan bulat.`, true)
    }
    const currentBalance = balances[operation.material.id] || 0
    if (operation.jenis === 'pakai' && quantity > currentBalance) {
      return say(`Jumlah tidak cukup. Saldo saat ini ${formatNumber(currentBalance)} ${operation.material.satuan}.`, true)
    }
    setSaving(true)
    const { error } = await sb.rpc('catat_mutasi_persediaan_bahan', {
      p_bahan_id: operation.material.id,
      p_jenis: operation.jenis,
      p_jumlah: quantity,
      p_catatan: note.trim() || null,
    })
    setSaving(false)
    if (error) return say('Perubahan persediaan gagal disimpan: ' + error.message, true)
    say(`${operation.jenis === 'tambah' ? 'Penambahan' : 'Pemakaian'} ${operation.material.nama} berhasil dicatat.`)
    setOperation(null)
    await load()
  }

  const materialById = useMemo(
    () => Object.fromEntries(materials.map((material) => [material.id, material])),
    [materials],
  )

  return (
    <section className="inventory-page">
      <div className="inventory-heading">
        <div>
          <span className="finance-eyebrow">CATATAN PERSEDIAAN</span>
          <h2>Persediaan bahan baku</h2>
          <p>Catat setiap barang yang masuk atau dipakai. Bagian ini terpisah dari stok produk yang dijual di kasir.</p>
        </div>
        <span className="inventory-count">{materials.length} jenis bahan</span>
      </div>

      {isEmployee && (
        <div className="inventory-help">
          <span aria-hidden="true">i</span>
          <p>Saat pertama kali memakai fitur ini, catat jumlah yang tersedia lewat <b>Tambah</b>. Berikutnya pilih <b>Tambah</b> saat barang masuk dan <b>Pakai</b> saat barang digunakan.</p>
        </div>
      )}
      {!isEmployee && (
        <div className="inventory-help">
          <span aria-hidden="true">i</span>
          <p>Karyawan mencatat bahan masuk dan pemakaian. Saldo dan riwayat perubahan dapat dipantau di sini.</p>
        </div>
      )}

      <label className="inventory-search-label" htmlFor="inventory-search">Cari bahan</label>
      <input
        id="inventory-search"
        className="inventory-search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Contoh: tepung, pisang, kemasan"
      />

      {operation && (
        <form className="box inventory-operation" onSubmit={submitOperation}>
          <div className="inventory-operation-heading">
            <div>
              <span className="finance-eyebrow">{operation.jenis === 'tambah' ? 'BARANG MASUK' : 'BARANG DIPAKAI'}</span>
              <h3>{operation.material.nama}</h3>
            </div>
            <button type="button" className="btn alt" onClick={() => setOperation(null)}>Batal</button>
          </div>
          <p className="muted">Saldo saat ini: <b>{formatNumber(balances[operation.material.id])} {operation.material.satuan}</b></p>
          <label htmlFor="inventory-amount">Jumlah ({operation.material.satuan})</label>
          <input
            id="inventory-amount"
            autoFocus
            type="number"
            min="0.001"
            step={operation.material.satuan === 'ltr' ? '0.001' : '1'}
            inputMode="decimal"
            required
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder={operation.material.satuan === 'ltr' ? 'Contoh: 0.5' : 'Contoh: 1'}
          />
          <label htmlFor="inventory-note">Catatan <span className="inventory-optional">(opsional)</span></label>
          <input id="inventory-note" maxLength="160" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Contoh: stok baru datang" />
          <button className="btn red full" type="submit" disabled={saving}>{saving ? 'Menyimpan…' : 'Simpan catatan'}</button>
        </form>
      )}

      {loading ? <div className="box"><p className="muted">Memuat daftar bahan…</p></div> : (
        <>
          <div className="inventory-list">
            {visibleMaterials.map((material) => {
              const balance = balances[material.id] || 0
              return (
                <article className="box inventory-card" key={material.id}>
                  <div className="inventory-card-main">
                    <div className="inventory-material-icon" aria-hidden="true">{material.nama.slice(0, 1).toLocaleUpperCase('id')}</div>
                    <div className="inventory-material-info">
                      <h3>{material.nama}</h3>
                      <small>Persediaan saat ini</small>
                    </div>
                    <strong className="inventory-balance">{formatNumber(balance)} <small>{material.satuan}</small></strong>
                  </div>
                  {isEmployee && (
                    <div className="inventory-actions">
                      <button type="button" className="btn inventory-add" onClick={() => beginOperation(material, 'tambah')}>＋ Tambah</button>
                      <button type="button" className="btn inventory-use" disabled={balance <= 0} onClick={() => beginOperation(material, 'pakai')}>− Pakai</button>
                    </div>
                  )}
                </article>
              )
            })}
            {!visibleMaterials.length && <div className="box inventory-empty">{search ? 'Bahan tidak ditemukan.' : 'Daftar bahan belum tersedia.'}</div>}
          </div>

          <section className="box inventory-history">
            <div className="inventory-history-heading">
              <div><span className="finance-eyebrow">AKTIVITAS TERBARU</span><h2>Riwayat perubahan</h2></div>
              <span className="inventory-count">15 terakhir</span>
            </div>
            {history.map((entry) => {
              const material = materialById[entry.bahan_id]
              return (
                <article className="inventory-history-row" key={entry.id}>
                  <span className={`inventory-history-icon ${entry.jenis === 'tambah' ? 'is-add' : 'is-use'}`} aria-hidden="true">{entry.jenis === 'tambah' ? '+' : '−'}</span>
                  <div className="inventory-history-info">
                    <b>{material?.nama || 'Bahan'}</b>
                    <small>{entry.jenis === 'tambah' ? 'Ditambahkan' : 'Dipakai'} oleh {recorderNames[entry.dicatat_oleh] || 'anggota tim'} · {formatDateTime(entry.dibuat_pada)}{entry.catatan ? ` · ${entry.catatan}` : ''}</small>
                  </div>
                  <strong className={entry.jenis === 'tambah' ? 'inventory-positive' : 'inventory-negative'}>
                    {entry.jenis === 'tambah' ? '+' : '−'}{formatNumber(entry.jumlah)} {material?.satuan || ''}
                  </strong>
                </article>
              )
            })}
            {!history.length && <p className="muted inventory-empty">Belum ada perubahan stok yang dicatat.</p>}
          </section>
        </>
      )}
    </section>
  )
}
