import { useCallback, useEffect, useMemo, useState } from 'react'
import { sb, today } from './lib.js'

const WEEKDAYS = [
  { day: 1, label: 'Senin' },
  { day: 2, label: 'Selasa' },
  { day: 3, label: 'Rabu' },
  { day: 4, label: 'Kamis' },
  { day: 5, label: 'Jumat' },
  { day: 6, label: 'Sabtu' },
  { day: 0, label: 'Minggu' },
]
const STATUS_LABELS = { belum: 'Belum dikerjakan', proses: 'Sedang dikerjakan', selesai: 'Selesai' }
const SHIFT_DEFINITIONS = [
  { nama: 'Pagi', jam_mulai: '09:00', jam_selesai: '13:00' },
  { nama: 'Siang', jam_mulai: '12:00', jam_selesai: '17:00' },
  { nama: 'Full-time', jam_mulai: '09:00', jam_selesai: '17:00' },
]
const EMPTY_WEEK = Object.fromEntries(WEEKDAYS.map(({ day }) => [day, 'off']))

const localDate = (date = new Date()) => {
  const offset = date.getTimezoneOffset()
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10)
}

export default function TeamWork({ me, say }) {
  const isManager = String(me.peran).trim().toLowerCase() === 'manager'
  const [employees, setEmployees] = useState([])
  const [shifts, setShifts] = useState([])
  const [weekly, setWeekly] = useState([])
  const [override, setOverride] = useState([])
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [scheduleEmployeeId, setScheduleEmployeeId] = useState('')
  const [scheduleWeek, setScheduleWeek] = useState(EMPTY_WEEK)
  const [overrideForm, setOverrideForm] = useState({ karyawan_id: '', tanggal: today(), shift_id: '', libur: false })
  const [jobForm, setJobForm] = useState({ karyawan_id: '', tanggal: today(), tugas: '' })

  const branchId = me.cabang_id
  const employeeById = useMemo(() => Object.fromEntries(employees.map((employee) => [employee.id, employee])), [employees])

  const load = useCallback(async () => {
    if (!branchId) {
      setLoading(false)
      return
    }
    setLoading(true)
    const [employeeResult, shiftResult, weeklyResult, overrideResult, jobResult] = await Promise.all([
      sb.from('profil').select('id,nama,peran').eq('cabang_id', branchId).eq('aktif', true).eq('peran', 'karyawan').order('nama'),
      sb.from('shift_definisi').select('id,nama,jam_mulai,jam_selesai').eq('cabang_id', branchId).eq('aktif', true).in('nama', ['Pagi', 'Siang', 'Full-time']).order('jam_mulai'),
      sb.from('jadwal_mingguan').select('id,karyawan_id,hari,shift_id,shift_definisi!jadwal_mingguan_shift_satu_cabang(id,nama,jam_mulai,jam_selesai)').eq('cabang_id', branchId).order('hari'),
      sb.from('jadwal_tanggal').select('id,karyawan_id,tanggal,shift_id,libur,shift_definisi!jadwal_tanggal_shift_satu_cabang(id,nama,jam_mulai,jam_selesai)').eq('cabang_id', branchId).eq('tanggal', today()),
      sb.from('jobdesk').select('id,karyawan_id,tanggal,tugas,status,dibuat_pada').eq('cabang_id', branchId).eq('tanggal', today()).order('dibuat_pada'),
    ])
    const failed = [employeeResult, shiftResult, weeklyResult, overrideResult, jobResult].find((result) => result.error)
    if (failed) {
      say('Data jadwal/jobdesk gagal dimuat: ' + failed.error.message, true)
      setLoading(false)
      return
    }
    const staff = employeeResult.data || []
    const shiftsByKey = new Map((shiftResult.data || []).map((shift) => [
      `${shift.nama}|${shift.jam_mulai.slice(0, 5)}|${shift.jam_selesai.slice(0, 5)}`,
      shift,
    ]))
    const fixedShifts = SHIFT_DEFINITIONS
      .map((definition) => {
        return shiftsByKey.get(`${definition.nama}|${definition.jam_mulai}|${definition.jam_selesai}`) || null
      })
      .filter(Boolean)
    setEmployees(staff)
    setShifts(fixedShifts)
    setWeekly(weeklyResult.data || [])
    setOverride(overrideResult.data || [])
    setJobs(jobResult.data || [])
    const selectedEmployee = staff.some((person) => person.id === scheduleEmployeeId) ? scheduleEmployeeId : staff[0]?.id || ''
    setScheduleEmployeeId(selectedEmployee)
    setScheduleWeek(Object.fromEntries(WEEKDAYS.map(({ day }) => {
      const current = (weeklyResult.data || []).find((row) => row.karyawan_id === selectedEmployee && row.hari === day)
      return [day, current?.libur ? 'off' : current?.shift_id || 'off']
    })))
    setOverrideForm((current) => ({ ...current, karyawan_id: staff.some((person) => person.id === current.karyawan_id) ? current.karyawan_id : staff[0]?.id || '', shift_id: fixedShifts.some((shift) => shift.id === current.shift_id) ? current.shift_id : fixedShifts[0]?.id || '' }))
    setJobForm((current) => ({ ...current, karyawan_id: staff.some((person) => person.id === current.karyawan_id) ? current.karyawan_id : staff[0]?.id || '' }))
    setLoading(false)
  }, [branchId, say])

  useEffect(() => { load() }, [load])

  const selectScheduleEmployee = (employeeId) => {
    setScheduleEmployeeId(employeeId)
    setScheduleWeek(Object.fromEntries(WEEKDAYS.map(({ day }) => {
      const current = weekly.find((row) => row.karyawan_id === employeeId && row.hari === day)
      return [day, current?.libur ? 'off' : current?.shift_id || 'off']
    })))
  }

  const saveWeekly = async (event) => {
    event.preventDefault()
    if (!scheduleEmployeeId) return say('Pilih karyawan.', true)
    setSaving(true)
    const changes = WEEKDAYS.map(({ day }) => ({
      cabang_id: branchId,
      karyawan_id: scheduleEmployeeId,
      hari: day,
      shift_id: scheduleWeek[day] === 'off' ? null : scheduleWeek[day],
      libur: scheduleWeek[day] === 'off',
      diubah_oleh: me.id,
    }))
    const { error } = await sb.from('jadwal_mingguan').upsert(changes, { onConflict: 'cabang_id,karyawan_id,hari' })
    setSaving(false)
    if (error) return say('Jadwal mingguan gagal disimpan: ' + error.message, true)
    say('Jadwal satu minggu berhasil disimpan.')
    await load()
  }

  const saveOverride = async (event) => {
    event.preventDefault()
    if (!overrideForm.karyawan_id || (!overrideForm.libur && !overrideForm.shift_id)) {
      return say('Pilih karyawan dan shift, atau tandai sebagai libur.', true)
    }
    setSaving(true)
    const { error } = await sb.from('jadwal_tanggal').upsert({
      cabang_id: branchId,
      karyawan_id: overrideForm.karyawan_id,
      tanggal: overrideForm.tanggal,
      shift_id: overrideForm.libur ? null : overrideForm.shift_id,
      libur: overrideForm.libur,
      diubah_oleh: me.id,
    }, { onConflict: 'cabang_id,karyawan_id,tanggal' })
    setSaving(false)
    if (error) return say('Jadwal tanggal khusus gagal disimpan: ' + error.message, true)
    say('Jadwal tanggal khusus tersimpan.')
    if (overrideForm.tanggal === today()) await load()
  }

  const addJob = async (event) => {
    event.preventDefault()
    const tugas = jobForm.tugas.trim()
    if (!jobForm.karyawan_id || !tugas) return say('Pilih karyawan dan isi jobdesk.', true)
    setSaving(true)
    const { error } = await sb.from('jobdesk').insert({
      cabang_id: branchId,
      karyawan_id: jobForm.karyawan_id,
      tanggal: jobForm.tanggal,
      tugas,
      dibuat_oleh: me.id,
    })
    setSaving(false)
    if (error) return say('Jobdesk gagal ditambahkan: ' + error.message, true)
    setJobForm((current) => ({ ...current, tugas: '' }))
    say('Jobdesk berhasil ditambahkan.')
    if (jobForm.tanggal === today()) await load()
  }

  const updateStatus = async (job, status) => {
    const { error } = await sb.rpc('ubah_status_jobdesk', { p_jobdesk_id: job.id, p_status: status })
    if (error) return say('Status jobdesk gagal diperbarui: ' + error.message, true)
    setJobs((current) => current.map((row) => row.id === job.id ? { ...row, status } : row))
  }

  const removeJob = async (job) => {
    if (!window.confirm('Hapus jobdesk ini?')) return
    const { error } = await sb.from('jobdesk').delete().eq('id', job.id)
    if (error) return say('Jobdesk gagal dihapus: ' + error.message, true)
    say('Jobdesk dihapus.')
    await load()
  }

  if (!branchId) return <p className="box">Akun ini belum terhubung ke cabang aktif.</p>

  const currentDay = new Date(`${localDate()}T12:00:00`).getDay()
  const personalOverride = override.find((row) => row.karyawan_id === me.id)
  const personalWeekly = weekly.find((row) => row.karyawan_id === me.id && row.hari === currentDay)
  const personalShift = personalOverride
    ? (personalOverride.libur ? null : personalOverride.shift_definisi)
    : personalWeekly?.shift_definisi

  return (
    <section className="team-work">
      <div className="team-work-heading">
        <div>
          <span className="finance-eyebrow">{isManager ? 'PENGELOLAAN TIM' : 'HARI KERJA'}</span>
          <h1>{isManager ? 'Jadwal & jobdesk' : 'Tugas hari ini'}</h1>
          <p>{isManager ? 'Atur shift mingguan dan tugas harian untuk tim cabang.' : 'Lihat shift dan perbarui progres tugasmu.'}</p>
        </div>
      </div>

      {!isManager && (
        <section className="box team-today-shift">
          <span className="finance-eyebrow">JADWAL HARI INI</span>
          {personalOverride?.libur
            ? <h2>Hari libur</h2>
            : personalShift
              ? <h2>{personalShift.nama} · {personalShift.jam_mulai.slice(0, 5)}–{personalShift.jam_selesai.slice(0, 5)}</h2>
              : <h2>Belum ada shift dijadwalkan</h2>}
        </section>
      )}

      {isManager && (
        <>
          {!loading && !employees.length && (
            <p className="box team-no-employees">Belum ada karyawan aktif yang terhubung ke cabang ini. Jadwal dan jobdesk hanya bisa diberikan kepada akun berperan karyawan.</p>
          )}
          <div className="team-work-grid">
            <section className="box team-work-card">
              <span className="finance-eyebrow">1 · DAFTAR SHIFT</span>
              <h2>Shift yang tersedia</h2>
              <p className="team-shift-intro">Pilih shift untuk setiap hari kerja. Jadwal shift berlaku untuk satu karyawan selama seminggu.</p>
              <div className="team-shift-list">
                {SHIFT_DEFINITIONS.map((shift) => (
                  <span key={shift.nama}><b>{shift.nama}</b><small>{shift.jam_mulai}–{shift.jam_selesai}</small></span>
                ))}
              </div>
            </section>

            <form className="box team-work-card" onSubmit={saveWeekly}>
              <span className="finance-eyebrow">2 · JADWAL BERULANG</span>
              <h2>Jadwal satu minggu</h2>
              <label htmlFor="weekly-employee">Karyawan</label>
              <select id="weekly-employee" required value={scheduleEmployeeId} onChange={(event) => selectScheduleEmployee(event.target.value)}>
                {!employees.length && <option value="">Belum ada karyawan aktif</option>}
                {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.nama} · {employee.peran}</option>)}
              </select>
              <div className="weekly-schedule-table">
                {WEEKDAYS.map(({ day, label }) => (
                  <label className="weekly-schedule-row" key={day}>
                    <b>{label}</b>
                    <select
                      aria-label={`Shift ${label}`}
                      value={scheduleWeek[day] || 'off'}
                      onChange={(event) => setScheduleWeek((current) => ({ ...current, [day]: event.target.value }))}
                    >
                      <option value="off">Libur</option>
                      {shifts.map((shift) => <option key={shift.id} value={shift.id}>{shift.nama} · {shift.jam_mulai.slice(0, 5)}–{shift.jam_selesai.slice(0, 5)}</option>)}
                    </select>
                  </label>
                ))}
              </div>
              <button className="btn red full" type="submit" disabled={saving || !shifts.length || !employees.length}>{saving ? 'Menyimpan…' : 'Simpan jadwal satu minggu'}</button>
            </form>

            <form className="box team-work-card" onSubmit={saveOverride}>
              <span className="finance-eyebrow">3 · PERUBAHAN TANGGAL</span>
              <h2>Atur jadwal khusus</h2>
              <label htmlFor="override-employee">Karyawan</label>
              <select id="override-employee" required value={overrideForm.karyawan_id} onChange={(event) => setOverrideForm((current) => ({ ...current, karyawan_id: event.target.value }))}>
                {!employees.length && <option value="">Belum ada karyawan aktif</option>}
                {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.nama} · {employee.peran}</option>)}
              </select>
              <label htmlFor="override-date">Tanggal</label>
              <input id="override-date" type="date" required value={overrideForm.tanggal} onChange={(event) => setOverrideForm((current) => ({ ...current, tanggal: event.target.value }))} />
              <label className="team-day-off"><input type="checkbox" checked={overrideForm.libur} onChange={(event) => setOverrideForm((current) => ({ ...current, libur: event.target.checked }))} /> Jadikan hari libur</label>
              {!overrideForm.libur && <><label htmlFor="override-shift">Shift pengganti</label><select id="override-shift" required value={overrideForm.shift_id} onChange={(event) => setOverrideForm((current) => ({ ...current, shift_id: event.target.value }))}><option value="">Pilih shift</option>{shifts.map((shift) => <option key={shift.id} value={shift.id}>{shift.nama} · {shift.jam_mulai.slice(0, 5)}–{shift.jam_selesai.slice(0, 5)}</option>)}</select></>}
              <button className="btn red full" type="submit" disabled={saving}>{saving ? 'Menyimpan…' : 'Simpan perubahan tanggal'}</button>
            </form>

            <form className="box team-work-card" onSubmit={addJob}>
              <span className="finance-eyebrow">4 · TUGAS HARIAN</span>
              <h2>Tambah jobdesk</h2>
              <label htmlFor="job-employee">Ditugaskan ke</label>
              <select id="job-employee" required value={jobForm.karyawan_id} onChange={(event) => setJobForm((current) => ({ ...current, karyawan_id: event.target.value }))}>
                {!employees.length && <option value="">Belum ada karyawan aktif</option>}
                {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.nama} · {employee.peran}</option>)}
              </select>
              <label htmlFor="job-date">Tanggal</label>
              <input id="job-date" type="date" required value={jobForm.tanggal} onChange={(event) => setJobForm((current) => ({ ...current, tanggal: event.target.value }))} />
              <label htmlFor="job-task">Tugas</label>
              <textarea id="job-task" required maxLength="500" rows="3" value={jobForm.tugas} onChange={(event) => setJobForm((current) => ({ ...current, tugas: event.target.value }))} placeholder="Tulis tugas yang perlu diselesaikan…" />
              <button className="btn red full" type="submit" disabled={saving || !employees.length}>{saving ? 'Menyimpan…' : 'Tambahkan jobdesk'}</button>
            </form>
          </div>

          <section className="box team-jobs">
            <div className="finance-panel-heading"><div><span className="finance-eyebrow">PEMANTAUAN</span><h2>Jobdesk hari ini</h2></div><span className="team-count">{jobs.length} tugas</span></div>
            {jobs.map((job) => (
              <article className="team-job-row" key={job.id}>
                <div><b>{job.tugas}</b><small>{employeeById[job.karyawan_id]?.nama || 'Anggota tim'} · {STATUS_LABELS[job.status] || job.status}</small></div>
                <button className="btn alt" type="button" onClick={() => removeJob(job)}>Hapus</button>
              </article>
            ))}
            {!jobs.length && <p className="muted team-empty">Belum ada jobdesk untuk hari ini.</p>}
          </section>
        </>
      )}

      {!isManager && (
        <section className="box team-jobs">
          <div className="finance-panel-heading"><div><span className="finance-eyebrow">DAFTAR HARI INI</span><h2>Jobdesk-ku</h2></div><span className="team-count">{jobs.length} tugas</span></div>
          {jobs.filter((job) => job.karyawan_id === me.id).map((job) => (
            <article className="team-job-row" key={job.id}>
              <div><b>{job.tugas}</b><small>{STATUS_LABELS[job.status] || job.status}</small></div>
              {job.status !== 'selesai' && <button className="btn red" type="button" onClick={() => updateStatus(job, job.status === 'belum' ? 'proses' : 'selesai')}>{job.status === 'belum' ? 'Mulai' : 'Tandai selesai'}</button>}
            </article>
          ))}
          {!jobs.some((job) => job.karyawan_id === me.id) && <p className="muted team-empty">Belum ada jobdesk untukmu hari ini.</p>}
        </section>
      )}

      {loading && <div className="box"><p className="muted">Memuat jadwal dan jobdesk…</p></div>}
      {!isManager && !loading && <p className="team-helper">Jika ada jadwal khusus untuk tanggal ini, jadwal tersebut menggantikan jadwal mingguan.</p>}
    </section>
  )
}
