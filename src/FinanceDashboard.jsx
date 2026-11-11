import { useCallback, useEffect, useState } from 'react'
import { sb, today } from './lib.js'

const money = (value) => value == null
  ? 'Belum tersedia'
  : 'Rp' + Number(value).toLocaleString('id-ID', { maximumFractionDigits: 0 })

const monthStart = (month) => `${month}-01`

const nextMonthStart = (month) => {
  const [year, value] = month.split('-').map(Number)
  return `${value === 12 ? year + 1 : year}-${String(value === 12 ? 1 : value + 1).padStart(2, '0')}-01`
}

export default function FinanceDashboard({ me, say }) {
  const [month, setMonth] = useState(today().slice(0, 7))
  const [products, setProducts] = useState([])
  const [hppDrafts, setHppDrafts] = useState({})
  const [savingProduct, setSavingProduct] = useState(null)
  const [report, setReport] = useState(null)
  const [branches, setBranches] = useState([])
  const [branchId, setBranchId] = useState(me.cabang_id || '')
  const [expenses, setExpenses] = useState([])
  const [expenseForm, setExpenseForm] = useState({ tanggal: today(), keterangan: '', jumlah: '' })
  const [loading, setLoading] = useState(true)
  const [savingExpense, setSavingExpense] = useState(false)

  const loadBranches = useCallback(async () => {
    const { data, error } = await sb.from('cabang').select('id,nama').eq('aktif', true).order('nama')
    if (error) {
      say('Daftar cabang gagal dimuat: ' + error.message, true)
      return
    }
    const rows = data || []
    setBranches(rows)
    if (!rows.some((branch) => branch.id === branchId)) setBranchId(rows[0]?.id || '')
  }, [branchId, say])

  const loadProducts = useCallback(async () => {
    if (!branchId) return
    const [{ data: productRows, error: productError }, { data: hppRows, error: hppError }] = await Promise.all([
      sb.from('produk').select('id,nama,aktif').order('urut'),
      sb.from('produk_hpp').select('produk_id,hpp').eq('cabang_id', branchId),
    ])
    if (productError || hppError) {
      say('Data HPP gagal dimuat: ' + (productError?.message || hppError?.message), true)
      return
    }
    const hpp = Object.fromEntries((hppRows || []).map((row) => [row.produk_id, String(row.hpp)]))
    setProducts(productRows || [])
    setHppDrafts(hpp)
  }, [branchId, say])

  const loadReport = useCallback(async () => {
    if (!branchId) {
      setLoading(false)
      return
    }
    setLoading(true)
    setReport(null)
    const { data, error } = await sb.rpc('laporan_laba_bulanan', {
      p_cabang: branchId,
      p_bulan: monthStart(month),
    })
    if (error) {
      say('Laporan gagal dimuat: ' + error.message, true)
      setLoading(false)
      return
    }
    setReport(data)

    const { data: expenseRows, error: expenseError } = await sb
      .from('pengeluaran')
      .select('id,tanggal,keterangan,jumlah')
      .eq('cabang_id', branchId)
      .gte('tanggal', monthStart(month))
      .lt('tanggal', nextMonthStart(month))
      .order('tanggal', { ascending: false })
    if (expenseError) say('Daftar pengeluaran gagal dimuat: ' + expenseError.message, true)
    else setExpenses(expenseRows || [])
    setLoading(false)
  }, [branchId, month, say])

  useEffect(() => { loadBranches() }, [loadBranches])
  useEffect(() => { loadProducts() }, [loadProducts])
  useEffect(() => { loadReport() }, [loadReport])

  const saveHpp = async (product) => {
    const value = hppDrafts[product.id]?.trim() ?? ''
    if (value !== '' && (!Number.isSafeInteger(Number(value)) || Number(value) < 0)) {
      return say('HPP harus berupa rupiah bulat nol atau lebih.', true)
    }
    setSavingProduct(product.id)
    const result = value === ''
      ? await sb.from('produk_hpp').delete().eq('produk_id', product.id).eq('cabang_id', branchId)
      : await sb.from('produk_hpp').upsert({ produk_id: product.id, cabang_id: branchId, hpp: Number(value) }, { onConflict: 'cabang_id,produk_id' })
    setSavingProduct(null)
    if (result.error) return say('HPP gagal disimpan: ' + result.error.message, true)
    say(value === '' ? `HPP ${product.nama} dihapus.` : `HPP ${product.nama} tersimpan.`)
    await loadProducts()
  }

  const addExpense = async (event) => {
    event.preventDefault()
    const amount = Number(expenseForm.jumlah)
    if (!Number.isSafeInteger(amount) || amount <= 0) return say('Jumlah pengeluaran harus berupa rupiah bulat lebih dari nol.', true)
    setSavingExpense(true)
    const { error } = await sb.from('pengeluaran').insert({
      cabang_id: branchId,
      tanggal: expenseForm.tanggal,
      keterangan: expenseForm.keterangan.trim(),
      jumlah: amount,
    })
    setSavingExpense(false)
    if (error) return say('Pengeluaran gagal disimpan: ' + error.message, true)
    setExpenseForm({ tanggal: today(), keterangan: '', jumlah: '' })
    say('Pengeluaran tersimpan.')
    await loadReport()
  }

  if (!branchId) {
    return <p className="box">Belum ada cabang aktif yang dapat ditampilkan.</p>
  }

  const cards = [
    { label: 'Penjualan produk', value: report?.penjualan, tone: 'sales' },
    { label: 'HPP produk terjual', value: report?.hpp, tone: 'cost' },
    { label: 'Laba kotor', value: report?.laba_kotor, tone: 'profit' },
    { label: 'Alokasi operasional · 50%', value: report?.alokasi_operasional, tone: 'operational' },
    { label: 'Laba bersih · 50%', value: report?.laba_bersih, tone: 'net' },
    { label: 'Saldo operasional', value: report?.saldo_operasional_akhir, tone: 'balance' },
  ]

  return (
    <section className="finance-dashboard">
      <div className="finance-heading">
        <div>
          <span className="finance-eyebrow">RINGKASAN CABANG</span>
          <h1>Keuangan</h1>
          <p>Ringkasan laba, biaya operasional, dan pembagian hasil.</p>
        </div>
        <div className="finance-period">
          <label htmlFor="finance-branch">Cabang</label>
          <select id="finance-branch" value={branchId} onChange={(event) => setBranchId(event.target.value)}>
            {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.nama}</option>)}
          </select>
          <label htmlFor="finance-month">Periode laporan</label>
          <input id="finance-month" type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
        </div>
      </div>

      {loading ? <div className="box"><p className="muted">Memuat laporan…</p></div> : report && (
        <>
          {(Number(report.hpp_transaksi_belum_diisi) > 0 || Number(report.hpp_historis_belum_diisi) > 0) && (
            <div className="box finance-warning" role="status">
              <b>Laporan HPP belum lengkap.</b>
              {Number(report.hpp_transaksi_belum_diisi) > 0 && <p>{report.hpp_transaksi_belum_diisi} item transaksi bulan ini belum punya snapshot HPP.</p>}
              {Number(report.hpp_historis_belum_diisi) > 0 && <p>{report.hpp_historis_belum_diisi} item transaksi sebelum bulan ini belum punya snapshot HPP, jadi saldo operasional awal belum bisa dihitung.</p>}
              <p>Lengkapi HPP produk sebelum mencatat transaksi baru. HPP tidak diterapkan mundur otomatis ke transaksi lama.</p>
            </div>
          )}
          <div className="finance-cards">
            {cards.map(({ label, value, tone }) => (
              <article className={`box finance-card finance-card-${tone}`} key={label}>
                <small>{label}</small>
                <strong>{money(value)}</strong>
              </article>
            ))}
          </div>
          <div className="finance-detail-grid">
            <section className="box finance-panel">
              <div className="finance-panel-heading">
                <div><span className="finance-eyebrow">ALOKASI</span><h2>Pembagian laba bersih</h2></div>
                <span className="finance-percent">100%</span>
              </div>
              <p className="finance-panel-copy">Dihitung dari 50% laba kotor setelah HPP.</p>
              <div className="finance-share-row"><span><i className="share-dot owner-dot" />3 pemilik <small>20% per orang</small></span><b>{money(report.pemilik_total)}</b></div>
              <div className="finance-share-row"><span><i className="share-dot manager-dot" />Bonus manager cabang <small>15%</small></span><b>{money(report.bonus_manager_cabang)}</b></div>
              <div className="finance-share-row"><span><i className="share-dot company-dot" />Kas perusahaan <small>25%</small></span><b>{money(report.kas_perusahaan)}</b></div>
              <p className="muted finance-footnote">Ini alokasi laporan, bukan transfer pembayaran otomatis.</p>
            </section>
            <section className="box finance-panel">
              <div className="finance-panel-heading">
                <div><span className="finance-eyebrow">DANA CABANG</span><h2>Operasional</h2></div>
                <strong className="finance-balance">{money(report.saldo_operasional_akhir)}</strong>
              </div>
              <p className="finance-panel-copy">Saldo akhir = saldo awal + alokasi bulan ini − pengeluaran.</p>
              <div className="finance-share-row"><span>Saldo awal bulan</span><b>{money(report.saldo_operasional_awal)}</b></div>
              <div className="finance-share-row"><span>Alokasi bulan ini</span><b>{money(report.alokasi_operasional)}</b></div>
              <div className="finance-share-row"><span>Pengeluaran bulan ini</span><b className="expense-value">− {money(report.pengeluaran_bulan)}</b></div>
            </section>
          </div>

          <details className="box finance-collapsible">
            <summary>
              <span><b>HPP per produk</b><small>Atur modal per unit untuk transaksi baru</small></span>
              <span className="details-chevron" aria-hidden="true">⌄</span>
            </summary>
            <div className="hpp-list">
              {products.map((product) => (
                <div className="hpp-row" key={product.id}>
                  <label htmlFor={`hpp-${product.id}`}>{product.nama}{!product.aktif ? ' (nonaktif)' : ''}</label>
                  <div>
                    <span className="hpp-currency">Rp</span>
                    <input
                      id={`hpp-${product.id}`}
                      type="number"
                      min="0"
                      step="1"
                      inputMode="numeric"
                      value={hppDrafts[product.id] ?? ''}
                      onChange={(event) => setHppDrafts((current) => ({ ...current, [product.id]: event.target.value }))}
                      placeholder="Belum diisi"
                    />
                    <button className="btn" type="button" disabled={savingProduct === product.id} onClick={() => saveHpp(product)}>
                      {savingProduct === product.id ? '…' : 'Simpan'}
                    </button>
                  </div>
                </div>
              ))}
              {!products.length && <p className="muted">Belum ada produk.</p>}
              <p className="muted finance-footnote">HPP yang diubah hanya berlaku untuk transaksi baru. Transaksi lama tetap memakai HPP yang tersimpan saat itu.</p>
            </div>
          </details>

          <div className="finance-detail-grid finance-expense-grid">
            <form className="box finance-panel" onSubmit={addExpense}>
              <div className="finance-panel-heading">
                <div><span className="finance-eyebrow">CATAT BIAYA</span><h2>Pengeluaran baru</h2></div>
              </div>
              <label htmlFor="expense-description">Untuk apa pengeluaran ini?</label>
              <input id="expense-description" required maxLength="160" value={expenseForm.keterangan} onChange={(event) => setExpenseForm((current) => ({ ...current, keterangan: event.target.value }))} placeholder="Contoh: gas, bahan kemasan, listrik" />
              <div className="row2">
                <div>
                  <label htmlFor="expense-amount">Jumlah (Rp)</label>
                  <input id="expense-amount" type="number" min="1" step="1" required value={expenseForm.jumlah} onChange={(event) => setExpenseForm((current) => ({ ...current, jumlah: event.target.value }))} placeholder="0" />
                </div>
                <div>
                  <label htmlFor="expense-date">Tanggal</label>
                  <input id="expense-date" type="date" required value={expenseForm.tanggal} onChange={(event) => setExpenseForm((current) => ({ ...current, tanggal: event.target.value }))} />
                </div>
              </div>
              <button className="btn red full" type="submit" disabled={savingExpense}>{savingExpense ? 'Menyimpan…' : 'Simpan pengeluaran'}</button>
            </form>

            <section className="box finance-panel">
              <div className="finance-panel-heading">
                <div><span className="finance-eyebrow">RIWAYAT</span><h2>Pengeluaran bulan ini</h2></div>
                <strong className="expense-value">{money(report.pengeluaran_bulan)}</strong>
              </div>
              <div className="finance-expenses">
                {expenses.map((expense) => (
                  <div className="finance-expense-row" key={expense.id}>
                    <div><b>{expense.keterangan}</b><small>{expense.tanggal}</small></div>
                    <strong>{money(expense.jumlah)}</strong>
                  </div>
                ))}
                {!expenses.length && <p className="finance-empty">Belum ada pengeluaran bulan ini.</p>}
              </div>
            </section>
          </div>
        </>
      )}
    </section>
  )
}
