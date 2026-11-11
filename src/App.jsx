import { useCallback, useEffect, useState } from 'react'
import { sb } from './lib.js'
import Kasir from './Kasir.jsx'
import Stok from './Stok.jsx'
import Absen from './Absen.jsx'
import Landing from './Landing.jsx'
import GalleryManager from './GalleryManager.jsx'
import AccountManager from './AccountManager.jsx'
import FinanceDashboard from './FinanceDashboard.jsx'
import ProdukManager from './ProdukManager.jsx'
import TeamWork from './TeamWork.jsx'
import SalesDashboard from './SalesDashboard.jsx'
import BranchManager from './BranchManager.jsx'
import CashDrawer from './CashDrawer.jsx'

const TABS = { kasir: ['Kasir', Kasir], stok: ['Stok', Stok], kas: ['Kas laci', CashDrawer], absen: ['Absen', Absen] }
const OWNER_ROLES = ['owner', 'pemilik']

const normalizeRole = (role) => String(role || '').trim().toLowerCase()
const defaultTabForRole = (role) => {
  const normalizedRole = normalizeRole(role)
  if (normalizedRole === 'pemilik' || normalizedRole === 'owner') return 'keuangan'
  if (normalizedRole === 'manager') return 'stok'
  return 'kasir'
}

function Login({ onDone, message }) {
  const [u, setU] = useState('')
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')
  const masuk = async (e) => {
    e.preventDefault()
    setErr('')
    const { error } = await sb.auth.signInWithPassword({ email: u.trim().toLowerCase() + '@toogi.app', password: pin })
    if (error) return setErr('Gagal: ' + error.message)
    setPin('')
    onDone()
  }
  return (
    <>
      <header><b>Kedai To’ogi’</b></header>
      <main>
        <form className="box" onSubmit={masuk}>
          <h2>Masuk</h2>
          <label htmlFor="u">Username</label>
          <input id="u" value={u} onChange={(e) => setU(e.target.value)} autoComplete="username" autoCapitalize="none" placeholder="mis. pemilik1" />
          <label htmlFor="pin">PIN</label>
          <input id="pin" type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} autoComplete="current-password" />
          {err && <p className="err">{err}</p>}
          {message && <p className="err" role="alert">{message}</p>}
          <button className="btn red full" type="submit">Masuk</button>
        </form>
      </main>
    </>
  )
}

export default function App() {
  const [kasirMode, setKasirMode] = useState(() => window.location.hash === '#/kasir')
  const [me, setMe] = useState(null)
  const [ready, setReady] = useState(false)
  const [tab, setTab] = useState('kasir')
  const [activeBranchId, setActiveBranchId] = useState('')
  const [note, setNote] = useState(null)
  const [loginMessage, setLoginMessage] = useState('')

  const say = useCallback((text, bad) => {
    setNote({ text, bad })
    setTimeout(() => setNote(null), 4500)
  }, [])

  const load = useCallback(async () => {
    const { data: { user } } = await sb.auth.getUser()
    if (!user) { setMe(null); setReady(true); return }
    const { data, error } = await sb.from('profil').select('nama,peran,cabang_id,aktif').eq('id', user.id).single()
    if (error || !data || !data.aktif) {
      const reason = error?.message || (!data ? 'Profil tidak ditemukan.' : 'Akun dinonaktifkan.')
      console.error('Profil pengguna gagal dimuat:', reason)
      await sb.auth.signOut()
      setMe(null)
      setLoginMessage(`Login diterima, tetapi profil akun gagal dibaca: ${reason}`)
    } else {
      setLoginMessage('')
      let branch = null
      if (data.cabang_id) {
        const { data: branchData, error: branchError } = await sb
          .from('cabang')
          .select('nama')
          .eq('id', data.cabang_id)
          .maybeSingle()
        if (branchError) {
          console.error('Cabang profil gagal dimuat:', branchError.message)
          say('Profil berhasil dimuat, tetapi nama cabang gagal dibaca: ' + branchError.message, true)
        } else {
          branch = branchData
        }
      }
      setTab(defaultTabForRole(data.peran))
      let assignedBranches = []
      if (normalizeRole(data.peran) === 'manager') {
        const { data: branchRows, error: branchError } = await sb.rpc('cabang_manager_saya')
        if (branchError) {
          say('Daftar cabang manager gagal dimuat: ' + branchError.message, true)
          console.error('Cabang manager gagal dimuat:', branchError.message)
        } else {
          assignedBranches = branchRows || []
        }
      }
      const selectedBranch = assignedBranches.find((branch) => branch.id === data.cabang_id) || assignedBranches[0]
      setActiveBranchId(selectedBranch?.id || '')
      setMe({ ...data, cabang: branch, id: user.id, assignedBranches })
    }
    setReady(true)
  }, [say])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const role = normalizeRole(me?.peran)
    if (role !== 'karyawan' && tab === 'kasir') setTab(defaultTabForRole(role))
  }, [me, tab])

  useEffect(() => {
    const syncRoute = () => setKasirMode(window.location.hash === '#/kasir')
    window.addEventListener('hashchange', syncRoute)
    return () => window.removeEventListener('hashchange', syncRoute)
  }, [])

  if (!kasirMode) return <Landing onOpenKasir={() => { window.location.hash = '/kasir' }} />
  if (!ready) return <p className="mid">Memuat…</p>
  if (!me) return <Login onDone={load} message={loginMessage} />

  const Page = TABS[tab]?.[1]
  const role = normalizeRole(me.peran)
  const branchChoices = me.assignedBranches || []
  const activeBranch = branchChoices.find((branch) => branch.id === activeBranchId)
  const scopedMe = role === 'manager'
    ? {
      ...me,
      primary_cabang_id: me.cabang_id,
      primary_cabang: me.cabang,
      cabang_id: activeBranch?.id || null,
      cabang: activeBranch ? { nama: activeBranch.nama } : null,
    }
    : me
  const canManageGallery = OWNER_ROLES.includes(role)
  const isOwner = role === 'pemilik' || role === 'owner'
  const isManager = role === 'manager'
  const isEmployee = role === 'karyawan'
  const isStaff = isEmployee || isManager
  const canManageProducts = isManager
  return (
    <>
      <header>
        <div>
          <b>{me.nama}</b>
          <small>{me.peran}{scopedMe.cabang ? ' · ' + scopedMe.cabang.nama : ''}</small>
        </div>
        <div className="header-actions">
          {isManager && branchChoices.length > 1 && (
            <label className="header-branch-picker">
              <span>Cabang aktif</span>
              <select aria-label="Pilih cabang aktif" value={activeBranchId} onChange={(event) => setActiveBranchId(event.target.value)}>
                {branchChoices.map((branch) => <option key={branch.id} value={branch.id}>{branch.nama}</option>)}
              </select>
            </label>
          )}
          <button className="btn alt" onClick={async () => { await sb.auth.signOut(); setMe(null) }}>Keluar</button>
        </div>
      </header>
      <main className={tab === 'keuangan' ? 'finance-main' : ''}>
        <nav className="tabs">
          {isStaff && Object.entries(TABS).filter(([k]) => k !== 'kasir' || isEmployee).map(([k, [label]]) => (
            <button key={k} className={'btn' + (k === tab ? ' on' : '')} onClick={() => setTab(k)}>{label}</button>
          ))}
          {isOwner && (
            <button className={'btn' + (tab === 'absen' ? ' on' : '')} onClick={() => setTab('absen')}>Absensi</button>
          )}
          {isStaff && (
            <button className={'btn' + (tab === 'jobdesk' ? ' on' : '')} onClick={() => setTab('jobdesk')}>{isManager ? 'Jadwal & jobdesk' : 'Jobdesk'}</button>
          )}
          {canManageProducts && (
            <button className={'btn' + (tab === 'produk' ? ' on' : '')} onClick={() => setTab('produk')}>Produk &amp; harga</button>
          )}
          {isOwner && (
            <button className={'btn' + (tab === 'cabang' ? ' on' : '')} onClick={() => setTab('cabang')}>Cabang</button>
          )}
          {(isManager || isOwner) && (
            <button className={'btn' + (tab === 'penjualan' ? ' on' : '')} onClick={() => setTab('penjualan')}>Penjualan</button>
          )}
          {canManageGallery && (
            <button className={'btn' + (tab === 'galeri' ? ' on' : '')} onClick={() => setTab('galeri')}>Foto kedai</button>
          )}
          {isOwner && (
            <button className={'btn' + (tab === 'keuangan' ? ' on' : '')} onClick={() => setTab('keuangan')}>Keuangan</button>
          )}
          {canManageGallery && (
            <button className={'btn' + (tab === 'akun' ? ' on' : '')} onClick={() => setTab('akun')}>Kelola akun</button>
          )}
        </nav>
        {tab === 'galeri'
          ? canManageGallery
            ? <GalleryManager say={say} />
            : <p className="box">Akun ini tidak memiliki akses untuk mengelola foto kedai.</p>
          : tab === 'akun'
          ? canManageGallery
            ? <AccountManager say={say} />
            : <p className="box">Akun ini tidak memiliki akses untuk mengelola akun.</p>
          : tab === 'keuangan'
          ? isOwner
            ? <FinanceDashboard me={me} say={say} />
            : <p className="box">Akun ini tidak memiliki akses ke laporan keuangan.</p>
          : tab === 'cabang'
          ? isOwner
            ? <BranchManager say={say} />
            : <p className="box">Akun ini tidak memiliki akses untuk mengelola cabang.</p>
          : tab === 'produk'
          ? canManageProducts
            ? <ProdukManager me={scopedMe} say={say} />
            : <p className="box">Akun ini tidak memiliki akses untuk mengubah produk.</p>
          : tab === 'jobdesk'
          ? isStaff
            ? <TeamWork me={scopedMe} say={say} />
            : <p className="box">Akun ini tidak memiliki akses ke jobdesk.</p>
          : tab === 'penjualan'
          ? isManager || isOwner
            ? <SalesDashboard me={scopedMe} say={say} />
            : <p className="box">Akun ini tidak memiliki akses ke laporan penjualan.</p>
          : tab === 'absen'
          ? isStaff || isOwner
            ? <Absen me={scopedMe} say={say} />
            : <p className="box">Akun ini tidak memiliki akses ke absensi.</p>
          : !me.cabang_id && tab !== 'absen'
          ? <p className="box">Akun ini belum terhubung ke cabang.</p>
          : isStaff && Page && (tab !== 'kasir' || isEmployee)
          ? <Page key={tab} me={scopedMe} say={say} />
          : <p className="box">Akun ini tidak memiliki akses ke halaman tersebut.</p>}
      </main>
      {note && <div className={'toast ' + (note.bad ? 'bad' : 'ok')}>{note.text}</div>}
    </>
  )
}
