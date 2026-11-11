import { useEffect, useState } from 'react'
import { sb, rp } from './lib.js'

export default function Kasir({ me, say }) {
  const [prod, setProd] = useState([])
  const [stok, setStok] = useState({})
  const [q, setQ] = useState({})
  const [ch, setCh] = useState('outlet')
  const [nama, setNama] = useState('')
  const [ongkir, setOngkir] = useState('')
  const [pay, setPay] = useState('qris')

  const load = async () => {
    const [p, s, prices] = await Promise.all([
      sb.from('produk').select('id,nama,harga_outlet,harga_shopee').eq('aktif', true).order('urut'),
      sb.from('saldo_stok_jualan').select('produk_id,jumlah').eq('cabang_id', me.cabang_id),
      sb.from('harga_produk_cabang').select('produk_id,harga_outlet,harga_shopee').eq('cabang_id', me.cabang_id),
    ])
    if (p.error || s.error || prices.error) {
      say('Produk, harga cabang, atau stok gagal dimuat: ' + (p.error?.message || s.error?.message || prices.error?.message), true)
      return
    }
    const priceByProduct = Object.fromEntries((prices.data || []).map((row) => [row.produk_id, row]))
    setProd((p.data || []).map((product) => ({ ...product, ...priceByProduct[product.id] })))
    setStok(Object.fromEntries((s.data || []).map((r) => [r.produk_id, Number(r.jumlah)])))
    setQ({})
  }
  useEffect(() => { load() }, [])

  const harga = (x) => (ch === 'shopee' ? x.harga_shopee : x.harga_outlet)
  const sub = prod.reduce((a, x) => a + (q[x.id] || 0) * (harga(x) || 0), 0)
  const ubah = (id, d) => setQ((o) => ({ ...o, [id]: Math.max(0, (o[id] || 0) + d) }))

  const simpan = async () => {
    const items = prod.filter((x) => q[x.id] > 0).map((x) => ({ produk_id: x.id, qty: q[x.id] }))
    if (!items.length) return say('Pilih produk dulu.', true)
    const { error } = await sb.rpc('buat_transaksi', {
      p_nama: nama.trim() || null,
      p_channel: ch,
      p_ongkir: +ongkir || 0,
      p_payment: ch === 'shopee' ? 'shopee_app' : pay,
      p_items: items,
    })
    if (error) return say(error.message, true)
    say('Transaksi tersimpan.')
    setNama(''); setOngkir(''); load()
  }

  return (
    <>
      <div className="box row2">
        <div>
          <label htmlFor="ch">Channel</label>
          <select id="ch" value={ch} onChange={(e) => {
            const channel = e.target.value
            setCh(channel)
            if (channel === 'shopee') setPay('shopee_app')
            else setPay((current) => current === 'shopee_app' ? 'qris' : current)
          }}>
            <option value="outlet">Outlet</option>
            <option value="shopee">Shopee</option>
          </select>
        </div>
        <div>
          <label htmlFor="nama">Nama pembeli</label>
          <input id="nama" value={nama} onChange={(e) => setNama(e.target.value)} placeholder="opsional" />
        </div>
      </div>

      <div className="box">
        {prod.map((x) => {
          const h = harga(x), st = stok[x.id]
          return (
            <div className="item" key={x.id}>
              <div>
                <b>{x.nama}</b><br />
                {h == null ? 'harga belum diisi' : rp(h)}{' '}
                <span className={'tag' + (st === undefined || st <= 0 ? ' low' : '')}>
                  {st === undefined ? 'stok belum diinput' : st <= 0 ? 'habis' : 'stok ' + st}
                </span>
              </div>
              <div className="step">
                <button onClick={() => ubah(x.id, -1)} aria-label="Kurangi">−</button>
                <b>{q[x.id] || 0}</b>
                <button onClick={() => ubah(x.id, 1)} disabled={h == null || st === undefined || (q[x.id] || 0) >= st} aria-label="Tambah">+</button>
              </div>
            </div>
          )
        })}
      </div>

      <div className="box">
        <div className="row2">
          <div>
            <label htmlFor="ongkir">Ongkir / lainnya</label>
            <input id="ongkir" type="number" min="0" inputMode="numeric" value={ongkir} onChange={(e) => setOngkir(e.target.value)} placeholder="0" />
          </div>
          <div>
            <label>{ch === 'shopee' ? 'Pembayaran Shopee' : 'Metode pembayaran'}</label>
            {ch === 'shopee'
              ? <p className="muted">Dibayar melalui aplikasi Shopee</p>
              : (
                <div className="pay">
                  {['qris', 'cash'].map((p) => (
                    <button key={p} type="button" className={pay === p ? 'on' : ''} onClick={() => setPay(p)}>{p === 'qris' ? 'Qris' : 'Cash'}</button>
                  ))}
                </div>
              )}
          </div>
        </div>
        <p className="sum">Subtotal <b>{rp(sub)}</b> · Total bayar <b>{rp(sub + (+ongkir || 0))}</b></p>
        <button className="btn red full" onClick={simpan}>Simpan transaksi</button>
      </div>
    </>
  )
}
