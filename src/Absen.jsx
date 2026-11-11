import { useCallback, useEffect, useMemo, useState } from 'react'
import { sb, today } from './lib.js'

const formatTime = (value) => new Date(value).toLocaleTimeString('id-ID', {
  timeZone: 'Asia/Jakarta',
  hour: '2-digit',
  minute: '2-digit',
})

const formatDate = (value) => new Date(`${value}T12:00:00`).toLocaleDateString('id-ID', {
  timeZone: 'Asia/Jakarta',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

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

const boundsForDate = (date) => ({
  start: `${date}T00:00:00+07:00`,
  end: `${nextDate(date)}T00:00:00+07:00`,
})

export default function Absen({ me, say }) {
  const role = String(me.peran).trim().toLowerCase()
  const isManager = role === 'manager'
  const isOwner = role === 'pemilik' || role === 'owner'
  const canViewTeam = isManager || isOwner
  const canViewMine = !isOwner
  const canClock = canViewMine && (!isManager || me.cabang_id === me.primary_cabang_id)
  const [mine, setMine] = useState([])
  const [team, setTeam] = useState([])
  const [branches, setBranches] = useState([])
  const [branchId, setBranchId] = useState(isOwner ? '' : me.cabang_id || '')
  const [reportDate, setReportDate] = useState(today())
  const [loadingMine, setLoadingMine] = useState(canViewMine)
  const [loadingTeam, setLoadingTeam] = useState(canViewTeam)
  const [busy, setBusy] = useState('')

  const loadMine = useCallback(async () => {
    if (!canViewMine) return
    const { data, error } = await sb
      .from('absensi')
      .select('id,jenis,waktu')
      .eq('karyawan_id', me.id)
      .order('waktu', { ascending: false })
      .limit(7)
    if (error) {
      say('Riwayat absensi gagal dimuat: ' + error.message, true)
      setLoadingMine(false)
      return
    }
    setMine(data || [])
    setLoadingMine(false)
  }, [canViewMine, me.id, say])

  const loadTeam = useCallback(async () => {
    if (!canViewTeam) return
    setLoadingTeam(true)
    if (isManager && !me.cabang_id) {
      setTeam([])
      setLoadingTeam(false)
      say('Akun manager belum terhubung ke cabang.', true)
      return
    }
    const [branchResult, peopleResult] = await Promise.all([
      isOwner
        ? sb.from('cabang').select('id,nama').eq('aktif', true).order('nama')
        : Promise.resolve({ data: [], error: null }),
      (() => {
        let query = sb.from('profil').select('id,nama,peran,cabang_id').eq('aktif', true).in('peran', ['karyawan', 'manager']).order('nama')
        if (isManager) query = query.eq('cabang_id', me.cabang_id)
        else if (branchId) query = query.eq('cabang_id', branchId)
        return query
      })(),
    ])
    if (branchResult.error || peopleResult.error) {
      say('Data pemantauan absensi gagal dimuat: ' + (branchResult.error?.message || peopleResult.error?.message), true)
      setLoadingTeam(false)
      return
    }
    if (isOwner) setBranches(branchResult.data || [])
    const people = peopleResult.data || []
    if (!people.length) {
      setTeam([])
      setLoadingTeam(false)
      return
    }
    const { start, end } = boundsForDate(reportDate)
    const { data: attendance, error } = await sb
      .from('absensi')
      .select('id,karyawan_id,jenis,waktu')
      .gte('waktu', start)
      .lt('waktu', end)
      .order('waktu')
    if (error) {
      say('Catatan absensi tim gagal dimuat: ' + error.message, true)
      setLoadingTeam(false)
      return
    }
    const recordsByPerson = new Map(people.map((person) => [person.id, []]))
    for (const record of attendance || []) {
      recordsByPerson.get(record.karyawan_id)?.push(record)
    }
    setTeam(people.map((person) => ({ ...person, records: recordsByPerson.get(person.id) || [] })))
    setLoadingTeam(false)
  }, [branchId, canViewTeam, isManager, isOwner, me.cabang_id, reportDate, say])

  useEffect(() => { loadMine() }, [loadMine])
  useEffect(() => { loadTeam() }, [loadTeam])
  useEffect(() => {
    if (isManager) setBranchId(me.cabang_id || '')
  }, [isManager, me.cabang_id])

  const todayRecords = useMemo(() => mine.filter((record) => dateInJakarta(record.waktu) === today()), [mine])
  const checkedIn = todayRecords.some((record) => record.jenis === 'masuk')
  const checkedOut = todayRecords.some((record) => record.jenis === 'pulang')
  const clockIn = (jenis) => {
    if (!navigator.geolocation) return say('Perangkat ini tidak mendukung akses lokasi. Hubungi manager untuk bantuan.', true)
    setBusy(jenis)
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { data, error } = await sb.rpc('absen', {
          p_jenis: jenis,
          p_lat: position.coords.latitude,
          p_lng: position.coords.longitude,
        })
        setBusy('')
        if (error) return say('Absen gagal disimpan: ' + error.message, true)
        say(`Absen ${jenis} berhasil. Lokasi tercatat dalam jarak ${data} m dari cabang.`)
        await loadMine()
      },
      (error) => {
        setBusy('')
        if (error.code === error.PERMISSION_DENIED) {
          say('Izin lokasi belum diberikan. Aktifkan akses lokasi browser lalu coba lagi.', true)
        } else if (error.code === error.TIMEOUT) {
          say('Lokasi belum berhasil didapat. Coba lagi di area dengan sinyal GPS lebih baik.', true)
        } else {
          say('Lokasi tidak dapat dibaca. Pastikan GPS perangkat aktif lalu coba lagi.', true)
        }
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    )
  }

  return (
    <section className="attendance-page">
      {canViewMine && (
        <section className="box attendance-checkin">
          <div className="attendance-heading">
            <div>
              <span className="finance-eyebrow">ABSENSI HARI INI</span>
              <h1>Halo, {me.nama}</h1>
              <p>{formatDate(today())}{(isManager ? me.primary_cabang?.nama : me.cabang?.nama) ? ` · ${isManager ? me.primary_cabang.nama : me.cabang.nama}` : ''}</p>
            </div>
            <span className={`attendance-status${checkedIn && !checkedOut ? ' is-active' : ''}`}>
              <i aria-hidden="true" />
              {loadingMine ? 'Memuat absensi…' : checkedOut ? 'Sudah pulang' : checkedIn ? 'Sedang bekerja' : 'Belum absen'}
            </span>
          </div>

          {!canClock && isManager && <p className="attendance-location-note">Absensi manager memakai cabang utama akun: <b>{me.primary_cabang?.nama || 'belum ditentukan'}</b>. Pilih cabang utama pada pemilih cabang sebelum mencatat masuk atau pulang.</p>}

          <div className="attendance-step-list">
            <article className={checkedIn ? 'is-complete' : ''}>
              <span className="attendance-step-number">{checkedIn ? '✓' : '1'}</span>
              <div><b>Absen masuk</b><small>{checkedIn ? `Tercatat pukul ${formatTime([...todayRecords].reverse().find((record) => record.jenis === 'masuk').waktu)} WIB` : 'Catat saat mulai bekerja'}</small></div>
            </article>
            <article className={checkedOut ? 'is-complete' : ''}>
              <span className="attendance-step-number">{checkedOut ? '✓' : '2'}</span>
              <div><b>Absen pulang</b><small>{checkedOut ? `Tercatat pukul ${formatTime([...todayRecords].reverse().find((record) => record.jenis === 'pulang').waktu)} WIB` : 'Catat saat selesai bekerja'}</small></div>
            </article>
          </div>

          <div className="attendance-actions">
            <button className="btn red" type="button" disabled={!canClock || loadingMine || busy !== '' || checkedIn} onClick={() => clockIn('masuk')}>
              {loadingMine ? 'Memuat…' : busy === 'masuk' ? 'Mencatat lokasi…' : checkedIn ? 'Absen masuk tercatat' : 'Absen masuk'}
            </button>
            <button className="btn attendance-out" type="button" disabled={!canClock || loadingMine || busy !== '' || !checkedIn || checkedOut} onClick={() => clockIn('pulang')}>
              {loadingMine ? 'Memuat…' : busy === 'pulang' ? 'Mencatat lokasi…' : checkedOut ? 'Absen pulang tercatat' : 'Absen pulang'}
            </button>
          </div>
          <p className="attendance-location-note"><span aria-hidden="true">⌖</span> Pastikan GPS aktif dan izinkan lokasi untuk mencatat kehadiran.</p>
        </section>
      )}

      {canClock && (
        <section className="box attendance-history">
          <div className="attendance-section-heading">
            <div><span className="finance-eyebrow">AKTIVITASMU</span><h2>Riwayat absensi</h2></div>
          </div>
          {loadingMine ? <p className="muted">Memuat riwayat…</p> : mine.map((record) => (
            <article className="attendance-history-row" key={record.id}>
              <span className={`attendance-record-icon ${record.jenis === 'masuk' ? 'is-in' : 'is-out'}`} aria-hidden="true">{record.jenis === 'masuk' ? '↓' : '↑'}</span>
              <div><b>Absen {record.jenis}</b><small>{new Date(record.waktu).toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', year: 'numeric' })}</small></div>
              <strong>{formatTime(record.waktu)} WIB</strong>
            </article>
          ))}
          {!loadingMine && !mine.length && <p className="attendance-empty">Riwayat absensi akan muncul di sini setelah kamu absen.</p>}
        </section>
      )}

      {canViewTeam && (
        <section className="box attendance-team">
          <div className="attendance-team-heading">
            <div><span className="finance-eyebrow">{isOwner ? 'PANTAU CABANG' : 'PEMANTAUAN TIM'}</span><h2>Catatan kehadiran</h2></div>
            <span className="attendance-team-count">{team.length} orang</span>
          </div>
          <div className="attendance-filters">
            {isOwner && (
              <div>
                <label htmlFor="attendance-branch">Cabang</label>
                <select id="attendance-branch" value={branchId} onChange={(event) => setBranchId(event.target.value)}>
                  <option value="">Semua cabang</option>
                  {branches.map((branch) => <option value={branch.id} key={branch.id}>{branch.nama}</option>)}
                </select>
              </div>
            )}
            <div>
              <label htmlFor="attendance-date">Tanggal</label>
              <input id="attendance-date" type="date" max={today()} value={reportDate} onChange={(event) => setReportDate(event.target.value)} />
            </div>
          </div>
          <p className="attendance-date-caption">{formatDate(reportDate)}</p>
          {loadingTeam ? <p className="muted">Memuat catatan tim…</p> : team.map((person) => (
            <article className="attendance-person-row" key={person.id}>
              <div className="attendance-person-name"><b>{person.nama}</b><small>{person.peran === 'manager' ? 'Manager' : 'Karyawan'}</small></div>
              {person.records.length ? (
                <div className="attendance-person-records">
                  {person.records.map((record) => (
                    <span key={record.id} className={record.jenis === 'masuk' ? 'record-in' : 'record-out'}>
                      {record.jenis === 'masuk' ? 'Masuk' : 'Pulang'} <b>{formatTime(record.waktu)}</b>
                    </span>
                  ))}
                </div>
              ) : <span className="attendance-no-record">Belum ada catatan</span>}
            </article>
          ))}
          {!loadingTeam && !team.length && <p className="attendance-empty">Tidak ada karyawan atau manager aktif pada cabang ini.</p>}
        </section>
      )}
    </section>
  )
}
