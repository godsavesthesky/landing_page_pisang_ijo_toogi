import { useCallback, useEffect, useMemo, useState } from 'react'
import { sb } from './lib.js'

const formatNumber = (value) => Number(value || 0).toLocaleString('id-ID')
const formatDateTime = (value) => new Date(value).toLocaleString('id-ID', {
  timeZone: 'Asia/Jakarta',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

export default function StokProduk({ me, say }) {
  const [products, setProducts] = useState([])
  const [balances, setBalances] = useState({})
  const [drafts, setDrafts] = useState({})
  const [history, setHistory] = useState([])
  const [recorderNames, setRecorderNames] = useState({})
  const [wasteProduct, setWasteProduct] = useState(null)
  const [wasteQuantity, setWasteQuantity] = useState('')
  const [wasteReason, setWasteReason] = useState('basi')
  const [wasteNote, setWasteNote] = useState('')
  const [correctionProduct, setCorrectionProduct] = useState(null)
  const [correction, setCorrection] = useState({ arah: 'keluar', jumlah: '', catatan: '' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const isEmployee = String(me.peran).trim().toLowerCase() === 'karyawan'

  const load = useCallback(async () => {
    setLoading(true)
    const [productsResult, balanceResult, historyResult] = await Promise.all([
      sb.from('produk').select('id,nama').eq('aktif', true).order('urut'),
      sb.from('saldo_stok_jualan').select('produk_id,jumlah').eq('cabang_id', me.cabang_id),
      sb.from('mutasi_stok_jualan')
        .select('id,produk_id,jenis,jumlah,catatan,dicatat_oleh,dibuat_pada')
        .eq('cabang_id', me.cabang_id)
        .order('dibuat_pada', { ascending: false })
        .limit(20),
    ])
    const failed = [productsResult, balanceResult, historyResult].find((result) => result.error)
    if (failed) {
      say('Stok produk gagal dimuat. Pastikan migrasi stok produksi sudah dijalankan: ' + failed.error.message, true)
      setLoading(false)
      return
    }

    const productRows = productsResult.data || []
    const balanceRows = balanceResult.data || []
    const historyRows = historyResult.data || []
    const nextBalances = Object.fromEntries(balanceRows.map((row) => [row.produk_id, Number(row.jumlah)]))
    const nextDrafts = Object.fromEntries(productRows.map((product) => [product.id, '']))
    const recorderIds = [...new Set(historyRows.map((row) => row.dicatat_oleh).filter(Boolean))]
    const recorderResult = recorderIds.length
      ? await sb.from('profil').select('id,nama').in('id', recorderIds)
      : { data: [], error: null }
    if (recorderResult.error) say('Nama pencatat belum dapat ditampilkan: ' + recorderResult.error.message, true)

    setProducts(productRows)
    setBalances(nextBalances)
    setDrafts(nextDrafts)
    setHistory(historyRows)
    setRecorderNames(Object.fromEntries((recorderResult.data || []).map((row) => [row.id, row.nama])))
    setLoading(false)
  }, [me.cabang_id, say])

  useEffect(() => { load() }, [load])

  const submitProduction = async (event) => {
    event.preventDefault()
    const items = products
      .filter((product) => drafts[product.id] !== '')
      .map((product) => ({ produk_id: product.id, jumlah: Number(drafts[product.id]) }))
    if (!items.length) return say('Masukkan jumlah produk yang selesai diproduksi.', true)
    if (items.some((item) => !Number.isSafeInteger(item.jumlah) || item.jumlah <= 0)) {
      return say('Jumlah hasil produksi harus berupa bilangan bulat lebih dari nol.', true)
    }
    setSaving(true)
    const { error } = await sb.rpc('catat_produksi_produk', { p_items: items })
    setSaving(false)
    if (error) return say('Hasil produksi gagal disimpan: ' + error.message, true)
    say('Hasil produksi berhasil ditambahkan ke stok siap jual.')
    await load()
  }

  const submitWaste = async (event) => {
    event.preventDefault()
    const quantity = Number(wasteQuantity)
    if (!wasteProduct || !Number.isSafeInteger(quantity) || quantity <= 0) {
      return say('Jumlah produk terbuang harus bilangan bulat lebih dari nol.', true)
    }
    if (quantity > (balances[wasteProduct.id] || 0)) {
      return say('Jumlah terbuang melebihi stok yang tersedia.', true)
    }
    setSaving(true)
    const { error } = await sb.rpc('catat_stok_terbuang', {
      p_produk_id: wasteProduct.id,
      p_jumlah: quantity,
      p_alasan: wasteReason,
      p_catatan: wasteNote.trim() || null,
    })
    setSaving(false)
    if (error) return say('Produk terbuang gagal dicatat: ' + error.message, true)
    say(`Produk ${wasteProduct.nama} yang terbuang berhasil dicatat.`)
    setWasteProduct(null)
    setWasteQuantity('')
    setWasteNote('')
    await load()
  }

  const submitCorrection = async (event) => {
    event.preventDefault()
    const quantity = Number(correction.jumlah)
    if (!correctionProduct || !Number.isSafeInteger(quantity) || quantity <= 0) {
      return say('Jumlah koreksi harus bilangan bulat lebih dari nol.', true)
    }
    if (correction.arah === 'keluar' && quantity > (balances[correctionProduct.id] || 0)) {
      return say('Jumlah koreksi keluar melebihi stok yang tersedia.', true)
    }
    if (correction.catatan.trim().length < 3) return say('Tuliskan alasan koreksi stok.', true)
    setSaving(true)
    const { error } = await sb.rpc('koreksi_stok_jualan', {
      p_produk_id: correctionProduct.id,
      p_arah: correction.arah,
      p_jumlah: quantity,
      p_catatan: correction.catatan.trim(),
      p_cabang_id: me.cabang_id,
    })
    setSaving(false)
    if (error) return say('Koreksi stok gagal disimpan: ' + error.message, true)
    say(`Koreksi stok ${correctionProduct.nama} berhasil dicatat.`)
    setCorrectionProduct(null)
    setCorrection({ arah: 'keluar', jumlah: '', catatan: '' })
    await load()
  }

  const productById = useMemo(
    () => Object.fromEntries(products.map((product) => [product.id, product])),
    [products],
  )

  return (
    <section className="product-stock-page">
      <div className="product-stock-intro">
        <div>
          <span className="finance-eyebrow">STOK SIAP JUAL</span>
          <h2>{isEmployee ? 'Catat hasil produksi' : 'Stok produk'}</h2>
          <p>
            {isEmployee
              ? 'Pertama kali, masukkan jumlah awal yang tersedia. Berikutnya catat hanya hasil produksi baru; sisa terbawa dan penjualan kasir mengurangi stok otomatis.'
              : 'Pantau stok siap jual. Hasil produksi menambah stok dan setiap transaksi kasir menguranginya otomatis.'}
          </p>
        </div>
      </div>

      {isEmployee && (
        <form className="box product-production-form" onSubmit={submitProduction}>
          <div className="product-production-heading">
            <div><span className="finance-eyebrow">SEBELUM MULAI JUALAN</span><h3>Catat stok produksi</h3></div>
            <span className="product-production-hint">Jumlah tambahan hari ini</span>
          </div>
          {loading ? <p className="muted">Memuat daftar produk…</p> : (
            <>
              <div className="production-list">
                {products.map((product) => (
                  <label className="production-row" key={product.id}>
                    <span><b>{product.nama}</b><small>Stok siap jual: {formatNumber(balances[product.id])} pcs</small></span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      inputMode="numeric"
                      aria-label={`Jumlah ${product.nama} yang baru diproduksi`}
                      value={drafts[product.id] ?? ''}
                      onChange={(event) => setDrafts((current) => ({ ...current, [product.id]: event.target.value }))}
                      placeholder="0"
                    />
                  </label>
                ))}
                {!products.length && <p className="muted">Belum ada produk aktif untuk dicatat.</p>}
              </div>
              <button className="btn red full" type="submit" disabled={saving || !products.length}>
                {saving ? 'Menyimpan…' : 'Simpan hasil produksi'}
              </button>
            </>
          )}
        </form>
      )}

      {wasteProduct && isEmployee && (
        <form className="box product-waste-form" onSubmit={submitWaste}>
          <div className="product-production-heading">
            <div><span className="finance-eyebrow">KOREKSI STOK</span><h3>Catat produk terbuang</h3></div>
            <button type="button" className="btn alt" onClick={() => setWasteProduct(null)}>Batal</button>
          </div>
          <p className="product-waste-product">{wasteProduct.nama} · stok tersedia {formatNumber(balances[wasteProduct.id])} pcs</p>
          <div className="product-waste-fields">
            <div>
              <label htmlFor="waste-quantity">Jumlah yang terbuang</label>
              <input id="waste-quantity" type="number" min="1" step="1" inputMode="numeric" required value={wasteQuantity} onChange={(event) => setWasteQuantity(event.target.value)} placeholder="Contoh: 2" />
            </div>
            <div>
              <label htmlFor="waste-reason">Alasan</label>
              <select id="waste-reason" value={wasteReason} onChange={(event) => setWasteReason(event.target.value)}>
                <option value="basi">Basi / kedaluwarsa</option>
                <option value="rusak">Rusak</option>
                <option value="jatuh/terkontaminasi">Jatuh / terkontaminasi</option>
                <option value="lainnya">Lainnya</option>
              </select>
            </div>
          </div>
          <label htmlFor="waste-note">Keterangan tambahan <span className="inventory-optional">(opsional)</span></label>
          <input id="waste-note" maxLength="160" value={wasteNote} onChange={(event) => setWasteNote(event.target.value)} placeholder="Tulis keterangan singkat" />
          <button className="btn red full" type="submit" disabled={saving}>{saving ? 'Menyimpan…' : 'Simpan produk terbuang'}</button>
        </form>
      )}

      {correctionProduct && (
        <form className="box product-waste-form" onSubmit={submitCorrection}>
          <div className="product-production-heading">
            <div><span className="finance-eyebrow">PENYESUAIAN STOK</span><h3>Koreksi selisih stok</h3></div>
            <button type="button" className="btn alt" onClick={() => setCorrectionProduct(null)}>Batal</button>
          </div>
          <p className="product-waste-product">{correctionProduct.nama} · saldo tercatat {formatNumber(balances[correctionProduct.id])} pcs</p>
          <div className="product-waste-fields">
            <div><label htmlFor="stock-correction-direction">Arah koreksi</label><select id="stock-correction-direction" value={correction.arah} onChange={(event) => setCorrection((current) => ({ ...current, arah: event.target.value }))}><option value="keluar">Kurangi saldo</option><option value="masuk">Tambah saldo</option></select></div>
            <div><label htmlFor="stock-correction-quantity">Jumlah</label><input id="stock-correction-quantity" type="number" min="1" step="1" required value={correction.jumlah} onChange={(event) => setCorrection((current) => ({ ...current, jumlah: event.target.value }))} /></div>
          </div>
          <label htmlFor="stock-correction-note">Alasan (wajib)</label>
          <input id="stock-correction-note" required minLength="3" maxLength="160" value={correction.catatan} onChange={(event) => setCorrection((current) => ({ ...current, catatan: event.target.value }))} placeholder="Contoh: hasil hitung fisik berbeda" />
          <button className="btn red full" type="submit" disabled={saving}>{saving ? 'Menyimpan…' : 'Simpan koreksi stok'}</button>
        </form>
      )}

      <section className="box product-balance-panel">
        <div className="product-stock-section-heading">
          <div><span className="finance-eyebrow">KETERSEDIAAN SEKARANG</span><h3>Stok siap dijual</h3></div>
          <span className="inventory-count">{products.length} produk</span>
        </div>
        {loading ? <p className="muted">Memuat stok…</p> : products.map((product) => (
          <article className="product-balance-row" key={product.id}>
            <span className="product-balance-icon" aria-hidden="true">{product.nama.slice(0, 1).toLocaleUpperCase('id')}</span>
            <b>{product.nama}</b>
            <strong>{formatNumber(balances[product.id])} <small>pcs</small></strong>
            {isEmployee && (
              <button
                className="btn product-waste-button"
                type="button"
                disabled={(balances[product.id] || 0) <= 0}
                onClick={() => {
                  setWasteProduct(product)
                  setWasteQuantity('')
                  setWasteReason('basi')
                  setWasteNote('')
                }}
              >
                Catat basi/rusak
              </button>
            )}
            {!isEmployee && (
              <button
                className="btn product-waste-button"
                type="button"
                onClick={() => {
                  setCorrectionProduct(product)
                  setCorrection({ arah: 'keluar', jumlah: '', catatan: '' })
                }}
              >
                Koreksi stok
              </button>
            )}
            {isEmployee && (
              <button
                className="btn product-waste-button"
                type="button"
                onClick={() => {
                  setCorrectionProduct(product)
                  setCorrection({ arah: 'keluar', jumlah: '', catatan: '' })
                }}
              >
                Koreksi selisih
              </button>
            )}
          </article>
        ))}
        {!loading && !products.length && <p className="muted">Belum ada produk aktif.</p>}
      </section>

      <section className="box product-stock-history">
        <div className="product-stock-section-heading">
          <div><span className="finance-eyebrow">AKTIVITAS TERBARU</span><h3>Riwayat stok produk</h3></div>
          <span className="inventory-count">20 terakhir</span>
        </div>
        {loading ? <p className="muted">Memuat riwayat…</p> : history.map((entry) => {
          const isProduction = entry.jenis === 'produksi'
          const isRestock = entry.jenis === 'retur'
          const isWaste = entry.jenis === 'terbuang'
          const isCorrectionIn = entry.jenis === 'koreksi_masuk'
          const isCorrectionOut = entry.jenis === 'koreksi_keluar'
          const sign = isProduction || isRestock || isCorrectionIn ? '+' : '−'
          const label = isProduction ? 'Produksi' : isRestock ? 'Stok dikembalikan' : isWaste ? 'Terbuang' : isCorrectionIn || isCorrectionOut ? 'Koreksi selisih' : 'Terjual'
          return (
            <article className="product-stock-history-row" key={entry.id}>
              <span className={`inventory-history-icon ${sign === '+' ? 'is-add' : 'is-use'}`} aria-hidden="true">{sign}</span>
              <div>
                <b>{productById[entry.produk_id]?.nama || 'Produk'}</b>
                <small>{label}{entry.dicatat_oleh ? ` oleh ${recorderNames[entry.dicatat_oleh] || 'anggota tim'}` : ''}{entry.catatan ? ` · ${entry.catatan}` : ''} · {formatDateTime(entry.dibuat_pada)}</small>
              </div>
              <strong className={sign === '+' ? 'inventory-positive' : 'inventory-negative'}>{sign}{formatNumber(entry.jumlah)} pcs</strong>
            </article>
          )
        })}
        {!loading && !history.length && <p className="inventory-empty">Belum ada produksi atau transaksi tercatat.</p>}
      </section>
    </section>
  )
}
