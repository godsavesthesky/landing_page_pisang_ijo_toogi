import { useCallback, useEffect, useState } from 'react'
import { sb } from './lib.js'

const emptyDraft = (product) => ({
  nama: product.nama,
  harga_outlet: String(product.harga_outlet ?? ''),
  harga_shopee: String(product.harga_shopee ?? ''),
  aktif: product.aktif,
})

export default function ProdukManager({ me, say }) {
  const [products, setProducts] = useState([])
  const [drafts, setDrafts] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(null)

  const loadProducts = useCallback(async () => {
    setLoading(true)
    if (!me.cabang_id) return
    const [{ data, error }, { data: priceRows, error: priceError }] = await Promise.all([
      sb.from('produk').select('id,nama,aktif,urut').order('urut'),
      sb.from('harga_produk_cabang').select('produk_id,harga_outlet,harga_shopee').eq('cabang_id', me.cabang_id),
    ])
    if (error || priceError) {
      say('Daftar produk atau harga cabang gagal dimuat: ' + (error?.message || priceError?.message), true)
      setLoading(false)
      return
    }
    const pricesByProduct = Object.fromEntries((priceRows || []).map((price) => [price.produk_id, price]))
    const rows = (data || []).map((product) => ({ ...product, ...pricesByProduct[product.id] }))
    setProducts(rows)
    setDrafts(Object.fromEntries(rows.map((product) => [product.id, emptyDraft(product)])))
    setLoading(false)
  }, [me.cabang_id, say])

  useEffect(() => { loadProducts() }, [loadProducts])

  const saveProduct = async (product) => {
    const draft = drafts[product.id]
    const name = draft.nama.trim()
    const outlet = Number(draft.harga_outlet)
    const shopee = draft.harga_shopee.trim() === '' ? null : Number(draft.harga_shopee)
    if (!name || name.length > 120) return say('Nama produk wajib diisi dan maksimal 120 karakter.', true)
    if (!Number.isSafeInteger(outlet) || outlet < 0) return say('Harga outlet harus berupa rupiah bulat nol atau lebih.', true)
    if (shopee !== null && (!Number.isSafeInteger(shopee) || shopee < 0)) {
      return say('Harga Shopee harus berupa rupiah bulat nol atau lebih, atau dikosongkan.', true)
    }

    setSaving(product.id)
    const { error } = await sb.rpc('ubah_produk_cabang', {
      p_produk_id: product.id,
      p_cabang_id: me.cabang_id,
      p_nama: name,
      p_harga_outlet: outlet,
      p_harga_shopee: shopee,
      p_aktif: draft.aktif,
    })
    setSaving(null)
    if (error) return say('Perubahan produk gagal disimpan: ' + error.message, true)
    say(`Produk ${name} berhasil diperbarui.`)
    await loadProducts()
  }

  return (
    <section className="product-manager">
      <div className="product-manager-heading">
        <div>
          <span className="finance-eyebrow">KATALOG TOKO</span>
          <h1>Produk &amp; harga</h1>
          <p>Harga berlaku khusus untuk {me.cabang?.nama || 'cabang ini'}; nama dan status produk berlaku untuk semua cabang.</p>
        </div>
      </div>
      {loading ? <div className="box"><p className="muted">Memuat produk…</p></div> : (
        <div className="product-manager-list">
          {products.map((product) => {
            const draft = drafts[product.id] || emptyDraft(product)
            return (
              <article className="box product-manager-card" key={product.id}>
                <div className="product-manager-card-heading">
                  <div>
                    <span className="finance-eyebrow">PRODUK</span>
                    <h2>{product.nama}</h2>
                  </div>
                  <label className="product-active-toggle">
                    <input
                      type="checkbox"
                      checked={draft.aktif}
                      onChange={(event) => setDrafts((current) => ({
                        ...current,
                        [product.id]: { ...draft, aktif: event.target.checked },
                      }))}
                    />
                    <span>{draft.aktif ? 'Aktif' : 'Nonaktif'}</span>
                  </label>
                </div>
                <label htmlFor={`product-name-${product.id}`}>Nama produk</label>
                <input
                  id={`product-name-${product.id}`}
                  maxLength="120"
                  value={draft.nama}
                  onChange={(event) => setDrafts((current) => ({
                    ...current,
                    [product.id]: { ...draft, nama: event.target.value },
                  }))}
                />
                <div className="product-price-grid">
                  <div>
                    <label htmlFor={`product-outlet-${product.id}`}>Harga outlet (Rp)</label>
                    <input
                      id={`product-outlet-${product.id}`}
                      type="number"
                      min="0"
                      step="1"
                      inputMode="numeric"
                      value={draft.harga_outlet}
                      onChange={(event) => setDrafts((current) => ({
                        ...current,
                        [product.id]: { ...draft, harga_outlet: event.target.value },
                      }))}
                    />
                  </div>
                  <div>
                    <label htmlFor={`product-shopee-${product.id}`}>Harga Shopee (Rp)</label>
                    <input
                      id={`product-shopee-${product.id}`}
                      type="number"
                      min="0"
                      step="1"
                      inputMode="numeric"
                      value={draft.harga_shopee}
                      onChange={(event) => setDrafts((current) => ({
                        ...current,
                        [product.id]: { ...draft, harga_shopee: event.target.value },
                      }))}
                      placeholder="Kosong jika tidak dijual"
                    />
                  </div>
                </div>
                <button className="btn red full" type="button" disabled={saving === product.id} onClick={() => saveProduct(product)}>
                  {saving === product.id ? 'Menyimpan…' : 'Simpan perubahan'}
                </button>
              </article>
            )
          })}
          {!products.length && <p className="box product-manager-empty">Belum ada produk di katalog.</p>}
        </div>
      )}
    </section>
  )
}
