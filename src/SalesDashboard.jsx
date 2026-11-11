import { useCallback, useEffect, useMemo, useState } from 'react'
import { sb, today } from './lib.js'

const money = (value) => 'Rp' + Number(value || 0).toLocaleString('id-ID', { maximumFractionDigits: 0 })
const monthStart = () => today().slice(0, 7) + '-01'
const nextDate = (date) => {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10)
}
const dateInJakarta = (value) => {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value))
  const part = Object.fromEntries(parts.map(({ type, value: partValue }) => [type, partValue]))
  return `${part.year}-${part.month}-${part.day}`
}

const initialTotals = () => ({
  outletCash: 0,
  outletQris: 0,
  shopeeApp: 0,
})

export default function SalesDashboard({ me, say, dailyOnly = false }) {
  const role = String(me.peran).trim().toLowerCase()
  const isOwner = role === 'pemilik' || role === 'owner'
  const canRefund = isOwner || role === 'manager'
  const [startDate, setStartDate] = useState(dailyOnly ? today() : monthStart())
  const [endDate, setEndDate] = useState(today())
  const [branchId, setBranchId] = useState(isOwner ? '' : me.cabang_id || '')
  const [branches, setBranches] = useState([])
  const [transactions, setTransactions] = useState([])
  const [refundEvents, setRefundEvents] = useState([])
  const [selectedTransaction, setSelectedTransaction] = useState(null)
  const [refundDrafts, setRefundDrafts] = useState({})
  const [refundReason, setRefundReason] = useState('')
  const [refundShipping, setRefundShipping] = useState(true)
  const [savingRefund, setSavingRefund] = useState(false)
  const [loading, setLoading] = useState(true)

  const loadBranches = useCallback(async () => {
    if (!isOwner) return
    const { data, error } = await sb.from('cabang').select('id,nama').eq('aktif', true).order('nama')
    if (error) {
      say('Daftar cabang gagal dimuat: ' + error.message, true)
      return
    }
    setBranches(data || [])
  }, [isOwner, say])

  const load = useCallback(async () => {
    if (!startDate || !endDate || startDate > endDate) return
    setLoading(true)
    setTransactions([])
    setRefundEvents([])
    const pageSize = 1000
    const rows = []
    for (let offset = 0; ; offset += pageSize) {
      let query = sb
        .from('transaksi')
        .select('id,tanggal,channel,payment,total,ongkir,dibatalkan_pada,alasan_pembatalan,item_transaksi(id,qty,qty_dikembalikan,qty_dikembalikan_ke_stok,produk_id,harga_satuan,hpp_satuan,produk(nama))')
        .gte('tanggal', startDate)
        .lte('tanggal', endDate)
        .order('tanggal')
        .range(offset, offset + pageSize - 1)
      if (branchId) query = query.eq('cabang_id', branchId)
      const { data, error } = await query
      if (error) {
        say('Data penjualan gagal dimuat: ' + error.message, true)
        setLoading(false)
        return
      }
      rows.push(...(data || []))
      if (!data || data.length < pageSize) break
    }
    if (rows.length) {
      const { data: refundRows, error: refundError } = await sb
        .from('refund_penjualan')
        .select('transaksi_id,jumlah_refund,ongkir_refund,alasan,dibuat_pada')
        .in('transaksi_id', rows.map((row) => row.id))
        .order('dibuat_pada')
      if (refundError) {
        say('Riwayat refund gagal dimuat: ' + refundError.message, true)
        setLoading(false)
        return
      }
      const refundsByTransaction = new Map()
      for (const refund of refundRows || []) {
        const aggregate = refundsByTransaction.get(refund.transaksi_id) || { amount: 0, shipping: 0, entries: [] }
        aggregate.amount += Number(refund.jumlah_refund || 0)
        aggregate.shipping += Number(refund.ongkir_refund || 0)
        aggregate.entries.push(refund)
        refundsByTransaction.set(refund.transaksi_id, aggregate)
      }
      setTransactions(rows.map((row) => ({
        ...row,
        refund_total: refundsByTransaction.get(row.id)?.amount || 0,
        refund_ongkir: refundsByTransaction.get(row.id)?.shipping || 0,
        refund_entries: refundsByTransaction.get(row.id)?.entries || [],
      })))
    } else {
      setTransactions([])
    }

    let refundQuery = sb
      .from('refund_penjualan')
      .select('id,transaksi_id,jumlah_refund,ongkir_refund,alasan,dibuat_pada')
      .gte('dibuat_pada', `${startDate}T00:00:00+07:00`)
      .lt('dibuat_pada', `${nextDate(endDate)}T00:00:00+07:00`)
      .order('dibuat_pada')
    if (branchId) refundQuery = refundQuery.eq('cabang_id', branchId)
    const { data: refunds, error: eventError } = await refundQuery
    if (eventError) {
      say('Data refund pada periode ini gagal dimuat: ' + eventError.message, true)
      setLoading(false)
      return
    }
    const saleRowsById = new Map(rows.map((row) => [row.id, row]))
    const externalTransactionIds = [...new Set((refunds || [])
      .map((refund) => refund.transaksi_id)
      .filter((id) => !saleRowsById.has(id)))]
    let externalTransactions = []
    if (externalTransactionIds.length) {
      const { data, error } = await sb.from('transaksi').select('id,channel,payment').in('id', externalTransactionIds)
      if (error) {
        say('Metode pembayaran untuk refund gagal dimuat: ' + error.message, true)
        setLoading(false)
        return
      }
      externalTransactions = data || []
    }
    const paymentByTransaction = new Map([
      ...rows.map((row) => [row.id, { channel: row.channel, payment: row.payment }]),
      ...externalTransactions.map((row) => [row.id, { channel: row.channel, payment: row.payment }]),
    ])
    setRefundEvents((refunds || []).map((refund) => ({
      ...refund,
      ...(paymentByTransaction.get(refund.transaksi_id) || {}),
    })))
    setLoading(false)
  }, [branchId, endDate, say, startDate])

  useEffect(() => { loadBranches() }, [loadBranches])
  useEffect(() => {
    if (!isOwner) setBranchId(me.cabang_id || '')
  }, [isOwner, me.cabang_id])
  useEffect(() => { load() }, [load])

  const report = useMemo(() => {
    const totals = initialTotals()
    const daily = new Map()
    const products = new Map()
    for (const transaction of transactions) {
      const channel = transaction.channel
      const payment = transaction.payment
      const gross = Number(transaction.total || 0) + Number(transaction.ongkir || 0)
      if (channel === 'outlet' && payment === 'cash') totals.outletCash += gross
      if (channel === 'outlet' && payment === 'qris') totals.outletQris += gross
      if (channel === 'shopee') totals.shopeeApp += gross
      daily.set(transaction.tanggal, (daily.get(transaction.tanggal) || 0) + gross)
      for (const item of transaction.item_transaksi || []) {
        const quantity = Math.max(0, Number(item.qty || 0) - Number(item.qty_dikembalikan || 0))
        if (!quantity) continue
        const product = Array.isArray(item.produk) ? item.produk[0] : item.produk
        const name = product?.nama || 'Produk'
        const entry = products.get(item.produk_id) || { id: item.produk_id, name, quantity: 0, sales: 0 }
        entry.quantity += quantity
        entry.sales += quantity * Number(item.harga_satuan || 0)
        products.set(item.produk_id, entry)
      }
    }
    for (const refund of refundEvents) {
      const channel = refund.channel
      const payment = refund.payment
      const amount = Number(refund.jumlah_refund || 0) + Number(refund.ongkir_refund || 0)
      if (channel === 'outlet' && payment === 'cash') totals.outletCash -= amount
      if (channel === 'outlet' && payment === 'qris') totals.outletQris -= amount
      if (channel === 'shopee') totals.shopeeApp -= amount
      const date = dateInJakarta(refund.dibuat_pada)
      daily.set(date, (daily.get(date) || 0) - amount)
    }
    const values = [...daily.entries()].sort(([a], [b]) => a.localeCompare(b))
    return {
      totals,
      total: Object.values(totals).reduce((sum, amount) => sum + amount, 0),
      daily: values,
      products: [...products.values()].sort((a, b) => b.quantity - a.quantity),
      transactions,
    }
  }, [refundEvents, transactions])

  const maxDaily = Math.max(1, ...report.daily.map(([, amount]) => amount))
  const lastRefundReason = (transaction) => transaction.refund_entries?.[transaction.refund_entries.length - 1]?.alasan

  const openRefund = (transaction) => {
    setSelectedTransaction(transaction)
    setRefundReason('')
    setRefundShipping(Number(transaction.refund_ongkir || 0) < Number(transaction.ongkir || 0))
    setRefundDrafts(Object.fromEntries((transaction.item_transaksi || []).map((item) => [
      item.id,
      { qty: '', restock: false },
    ])))
  }

  const submitRefund = async (cancelAll = false) => {
    if (!selectedTransaction) return
    const items = (selectedTransaction.item_transaksi || [])
      .map((item) => {
        const remaining = Math.max(0, Number(item.qty || 0) - Number(item.qty_dikembalikan || 0))
        const draft = refundDrafts[item.id] || {}
        return {
          item_id: item.id,
          qty: cancelAll ? remaining : Number(draft.qty || 0),
          restock: Boolean(draft.restock),
        }
      })
      .filter((item) => item.qty > 0)
    if (!items.length) return say('Masukkan jumlah item yang akan direfund.', true)
    if (!refundReason.trim() || refundReason.trim().length < 3) return say('Isi alasan refund minimal 3 karakter.', true)
    if (cancelAll && !window.confirm('Batalkan seluruh sisa transaksi dan catat refund?')) return
    setSavingRefund(true)
    const { error } = await sb.rpc('proses_refund_transaksi', {
      p_transaksi_id: selectedTransaction.id,
      p_items: items,
      p_batalkan: cancelAll,
      p_refund_ongkir: cancelAll && refundShipping,
      p_alasan: refundReason.trim(),
    })
    setSavingRefund(false)
    if (error) return say('Refund gagal diproses: ' + error.message, true)
    say(cancelAll ? 'Transaksi dibatalkan dan refund tercatat.' : 'Refund sebagian berhasil dicatat.')
    setSelectedTransaction(null)
    await load()
  }

  const refundable = (transaction) => transaction.dibatalkan_pada == null
    && (transaction.item_transaksi || []).some((item) => Number(item.qty_dikembalikan || 0) < Number(item.qty || 0))

  return (
    <section className="sales-dashboard">
      {!dailyOnly && (
        <div className="sales-heading">
          <div>
            <span className="finance-eyebrow">{isOwner ? 'REKAP PENJUALAN' : 'PENJUALAN OUTLET'}</span>
            <h1>{isOwner ? 'Penjualan produk' : 'Ringkasan penjualan'}</h1>
            <p>Rincian pembayaran outlet dan penjualan Shopee yang dibayar melalui aplikasi.</p>
          </div>
        </div>
      )}
      <section className="box sales-panel">
        <div className="sales-filters">
          {isOwner && (
            <div>
              <label htmlFor={dailyOnly ? 'daily-sales-branch' : 'sales-branch'}>Cabang</label>
              <select id={dailyOnly ? 'daily-sales-branch' : 'sales-branch'} value={branchId} onChange={(event) => setBranchId(event.target.value)}>
                <option value="">Semua cabang</option>
                {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.nama}</option>)}
              </select>
            </div>
          )}
          {!dailyOnly && (
            <>
              <div><label htmlFor="sales-start">Dari tanggal</label><input id="sales-start" type="date" value={startDate} max={endDate} onChange={(event) => setStartDate(event.target.value)} /></div>
              <div><label htmlFor="sales-end">Sampai tanggal</label><input id="sales-end" type="date" value={endDate} min={startDate} onChange={(event) => setEndDate(event.target.value)} /></div>
            </>
          )}
        </div>
        {loading ? <p className="muted">Memuat pemasukan…</p> : (
          <>
            <div className="sales-total-row"><span>{dailyOnly ? 'Total pemasukan hari ini' : 'Total pemasukan'}</span><strong>{money(report.total)}</strong></div>
            <div className="sales-channel-grid">
              <article><small>Outlet · Cash</small><b>{money(report.totals.outletCash)}</b></article>
              <article><small>Outlet · QRIS</small><b>{money(report.totals.outletQris)}</b></article>
              <article><small>Shopee · Dibayar di aplikasi</small><b>{money(report.totals.shopeeApp)}</b></article>
            </div>
            {!dailyOnly && (
              <>
                <div className="sales-chart-heading"><h2>Grafik pemasukan harian</h2><small>{report.daily.length} hari dengan transaksi</small></div>
                <div className="sales-chart" role="img" aria-label="Grafik pemasukan harian">
                  {report.daily.map(([date, amount]) => (
                    <div className="sales-chart-column" key={date} title={`${date}: ${money(amount)}`}>
                      <div className="sales-chart-bar" style={{ height: `${Math.max(4, amount / maxDaily * 100)}%` }} />
                      <small>{Number(date.slice(-2))}</small>
                    </div>
                  ))}
                  {!report.daily.length && <p className="muted">Belum ada transaksi pada rentang tanggal ini.</p>}
                </div>
                <div className="sales-day-list">
                  {report.daily.map(([date, amount]) => (
                    <div key={date}><span>{new Date(`${date}T12:00:00`).toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' })}</span><b>{money(amount)}</b></div>
                  ))}
                </div>
                {isOwner && (
                  <div className="sales-products">
                    <h2>Jumlah produk terjual</h2>
                    {report.products.map((product) => <div key={product.id}><span>{product.name}</span><b>{product.quantity} pcs · {money(product.sales)}</b></div>)}
                    {!report.products.length && <p className="muted">Belum ada produk terjual.</p>}
                  </div>
                )}
              </>
            )}
            <div className="sales-transactions">
              <h2>Transaksi dan refund</h2>
              {report.transactions?.map((transaction) => (
                <article className="sales-transaction-row" key={transaction.id}>
                  <div>
                    <b>{new Date(`${transaction.tanggal}T12:00:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })} · {transaction.channel === 'shopee' ? 'Shopee' : 'Outlet'} · {transaction.payment === 'cash' ? 'Cash' : transaction.payment === 'qris' ? 'QRIS' : 'Shopee'}</b>
                    <small>{transaction.dibatalkan_pada ? `Dibatalkan · ${transaction.alasan_pembatalan || 'tanpa catatan'}` : `Net setelah refund: ${money(Number(transaction.total) + Number(transaction.ongkir) - transaction.refund_total - transaction.refund_ongkir)}`}{transaction.refund_total > 0 && !transaction.dibatalkan_pada ? ` · Refund ${money(transaction.refund_total)} · ${lastRefundReason(transaction) || 'tanpa catatan'}` : ''}</small>
                  </div>
                  {canRefund && refundable(transaction) && <button className="btn" type="button" onClick={() => openRefund(transaction)}>Refund / batal</button>}
                </article>
              ))}
              {!report.transactions?.length && <p className="muted">Tidak ada transaksi pada rentang tanggal ini.</p>}
              {!!refundEvents.length && (
                <div className="sales-refund-events">
                  <h3>Refund dicatat pada periode ini</h3>
                  {refundEvents.map((refund) => (
                    <article className="sales-transaction-row" key={refund.id}>
                      <div><b>{dateInJakarta(refund.dibuat_pada)} · Refund {refund.channel === 'shopee' ? 'Shopee' : 'Outlet'}</b><small>{refund.alasan} · Transaksi {refund.transaksi_id.slice(0, 8)}</small></div>
                      <strong className="inventory-negative">−{money(Number(refund.jumlah_refund || 0) + Number(refund.ongkir_refund || 0))}</strong>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </section>
      {selectedTransaction && (
        <div className="refund-backdrop" role="presentation">
          <section className="box refund-dialog" role="dialog" aria-modal="true" aria-labelledby="refund-heading">
            <div className="refund-dialog-heading">
              <div><span className="finance-eyebrow">KOREKSI PENJUALAN</span><h2 id="refund-heading">Refund / batalkan transaksi</h2></div>
              <button className="btn alt" type="button" onClick={() => setSelectedTransaction(null)}>Tutup</button>
            </div>
            <p className="muted">Pilih jumlah item yang dikembalikan. Centang stok hanya jika barang kembali dalam kondisi layak dijual.</p>
            {(selectedTransaction.item_transaksi || []).map((item) => {
              const product = Array.isArray(item.produk) ? item.produk[0] : item.produk
              const remaining = Math.max(0, Number(item.qty || 0) - Number(item.qty_dikembalikan || 0))
              if (!remaining) return null
              const draft = refundDrafts[item.id] || { qty: '', restock: false }
              return (
                <div className="refund-item-row" key={item.id}>
                  <div><b>{product?.nama || 'Produk'}</b><small>Tersisa bisa direfund: {remaining} · {money(item.harga_satuan)} / pcs</small></div>
                  <input aria-label={`Jumlah refund ${product?.nama || 'produk'}`} type="number" min="0" max={remaining} step="1" value={draft.qty} onChange={(event) => setRefundDrafts((current) => ({ ...current, [item.id]: { ...draft, qty: event.target.value } }))} placeholder="0" />
                  <label><input type="checkbox" checked={draft.restock} onChange={(event) => setRefundDrafts((current) => ({ ...current, [item.id]: { ...draft, restock: event.target.checked } }))} /> Layak jual</label>
                </div>
              )
            })}
            <label htmlFor="refund-reason">Alasan refund (wajib)</label>
            <input id="refund-reason" minLength="3" maxLength="160" value={refundReason} onChange={(event) => setRefundReason(event.target.value)} />
            <label className="refund-shipping-toggle"><input type="checkbox" checked={refundShipping} onChange={(event) => setRefundShipping(event.target.checked)} /> Refund ongkir jika seluruh transaksi dibatalkan</label>
            <div className="refund-actions">
              <button className="btn" type="button" disabled={savingRefund} onClick={() => submitRefund(false)}>{savingRefund ? 'Menyimpan…' : 'Simpan refund sebagian'}</button>
              <button className="btn red" type="button" disabled={savingRefund} onClick={() => submitRefund(true)}>{savingRefund ? 'Memproses…' : 'Batalkan seluruh transaksi'}</button>
            </div>
          </section>
        </div>
      )}
    </section>
  )
}
