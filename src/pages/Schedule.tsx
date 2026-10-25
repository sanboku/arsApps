import { useMemo, useState } from 'react'
import type { Store } from '../store'
import { addDays, fmtMD, parseYmd, today, uid, weekStart } from '../store'
import type { DB, Job, Leave } from '../types'
import { DriverOptions, JobForm, Modal } from '../components'

type Row =
  | { kind: 'none'; key: string; label: string }
  | { kind: 'driver'; key: string; label: string; driverId: string }
  | { kind: 'company'; key: string; label: string; companyId: string; driverIds: string[] }

type FormState = { initial: Partial<Job>; isNew: boolean; title?: string; basic?: boolean }

export default function Schedule({ store }: { store: Store }) {
  const { db, update } = store
  const [start, setStart] = useState(() => weekStart(today()))
  const [form, setForm] = useState<FormState | null>(null)
  const [dayView, setDayView] = useState<string | null>(null)
  const [leaveOpen, setLeaveOpen] = useState(false)
  const [showHidden, setShowHidden] = useState(false)
  const [pick, setPick] = useState<{ jobId: string; date: string; companyId: string; copy: boolean } | null>(null)
  const [overKey, setOverKey] = useState('')

  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i))
  const end = days[6]
  const weekJobs = db.jobs.filter((j) => j.date >= start && j.date <= end)
  const busy = new Set(weekJobs.map((j) => j.driverId))
  const visible = (id: string) => showHidden || busy.has(id) || db.drivers.find((d) => d.id === id)?.showOnCalendar

  const rows = useMemo<Row[]>(() => {
    const r: Row[] = [{ kind: 'none', key: 'none', label: '担当者未定' }]
    for (const d of db.drivers.filter((d) => d.kind === 'employee' && visible(d.id)))
      r.push({ kind: 'driver', key: d.id, label: d.displayName, driverId: d.id })
    for (const d of db.drivers.filter((d) => d.kind === 'individual' && visible(d.id)))
      r.push({ kind: 'driver', key: d.id, label: d.displayName, driverId: d.id })
    for (const c of db.companies) {
      const ids = db.drivers.filter((d) => d.companyId === c.id && visible(d.id)).map((d) => d.id)
      if (ids.length) r.push({ kind: 'company', key: c.id, label: c.name, companyId: c.id, driverIds: ids })
    }
    return r
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, start, showHidden])

  const jobsIn = (row: Row, date: string) =>
    weekJobs.filter((j) => j.date === date && (
      row.kind === 'none' ? !j.driverId : row.kind === 'driver' ? j.driverId === row.driverId : row.driverIds.includes(j.driverId ?? '')))
  const leaveOf = (driverId: string, date: string) => db.leaves.find((l) => l.driverId === driverId && l.date === date)

  /** ドロップ時の処理。Ctrlキー（MacはOption）押しながらでコピー */
  const moveJob = (jobId: string, date: string, driverId: string | null, copy: boolean) =>
    update((db) => {
      const src = db.jobs.find((j) => j.id === jobId)
      if (!src) return db
      if (copy) return { ...db, jobs: [...db.jobs, { ...src, id: uid(), date, driverId, seriesId: undefined }] }
      return { ...db, jobs: db.jobs.map((j) => (j.id === jobId ? { ...j, date, driverId } : j)) }
    })

  const onDrop = (e: React.DragEvent, row: Row, date: string) => {
    e.preventDefault()
    setOverKey('')
    const jobId = e.dataTransfer.getData('text/plain')
    const copy = e.ctrlKey || e.altKey
    const job = db.jobs.find((j) => j.id === jobId)
    if (!job) return
    if (row.kind === 'none') moveJob(jobId, date, null, copy)
    else if (row.kind === 'driver') moveJob(jobId, date, row.driverId, copy)
    else if (job.driverId && row.driverIds.includes(job.driverId)) moveJob(jobId, date, job.driverId, copy)
    else setPick({ jobId, date, companyId: row.companyId, copy }) // 会社行へのドロップは担当者を選ぶ
  }

  const clientOf = (j: Job) => db.clients.find((c) => c.id === j.clientId)
  const driverOf = (id: string | null) => db.drivers.find((d) => d.id === id)

  // コンポーネント化するとドラッグ中の再描画で要素が作り直されるため、関数として描画する
  const renderCard = (j: Job, showDriver: boolean) => {
    const c = clientOf(j)
    return (
      <div
        key={j.id}
        className="job"
        draggable
        style={{ background: c?.color ?? '#94a3b8' }}
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', j.id)
          e.dataTransfer.effectAllowed = 'copyMove'
        }}
        onClick={(e) => {
          e.stopPropagation()
          setForm({ initial: j, isNew: false })
        }}
        title={j.note}
      >
        {showDriver && <div className="job-driver">{driverOf(j.driverId)?.displayName}</div>}
        <div className="job-client">{c?.name ?? '請求先未設定'}{j.vehicles > 1 && <span className="badge">×{j.vehicles}台</span>}{j.seriesId && <span title="定期案件"> 🔁</span>}</div>
        <div className="job-route">{j.pickups.filter(Boolean).join('・') || '—'} → {j.dropoffs.filter(Boolean).join('・') || '—'}</div>
      </div>
    )
  }

  return (
    <div className="page wide">
      <div className="toolbar">
        <h2>案件予定表</h2>
        <div className="row">
          <button className="ghost" onClick={() => setStart(addDays(start, -7))}>◀ 前週</button>
          <button className="ghost" onClick={() => setStart(weekStart(today()))}>今週</button>
          <button className="ghost" onClick={() => setStart(addDays(start, 7))}>次週 ▶</button>
          <input type="date" value={start} onChange={(e) => e.target.value && setStart(weekStart(e.target.value))} />
        </div>
        <div className="row">
          <button onClick={() => setForm({ initial: { date: start }, isNew: true })}>＋ 案件登録</button>
          <button className="secondary" onClick={() => setForm({ initial: { date: today() }, isNew: true, title: '基本割り当て登録（毎日固定の担当）', basic: true })}>基本割り当て</button>
          <button className="secondary" onClick={() => setLeaveOpen(true)}>休暇登録</button>
          <label className="inline small"><input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} />非表示ドライバーも表示</label>
        </div>
      </div>
      <p className="muted small">カードをドラッグで日付・担当を変更（Ctrl/Option を押しながらでコピー）。空きマスをクリックで案件登録、日付をクリックでその日の一覧。</p>

      <div className="sched-wrap">
        <table className="sched">
          <thead>
            <tr>
              <th className="sticky">ドライバー</th>
              {days.map((d) => {
                const dow = parseYmd(d).getDay()
                return (
                  <th key={d} className={`day ${d === today() ? 'today' : ''} ${dow === 0 ? 'sun' : dow === 6 ? 'sat' : ''}`} onClick={() => setDayView(d)}>
                    {fmtMD(d)}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className={row.kind === 'none' ? 'row-none' : row.kind === 'company' ? 'row-company' : ''}>
                <th className="sticky">
                  {row.label}
                  {row.kind === 'company' && <div className="muted small">{row.driverIds.length}名</div>}
                </th>
                {days.map((d) => {
                  const leave = row.kind === 'driver' ? leaveOf(row.driverId, d) : undefined
                  const k = `${row.key}_${d}`
                  return (
                    <td
                      key={d}
                      className={`${leave ? 'leave' : ''} ${overKey === k ? 'over' : ''}`}
                      onDragOver={(e) => {
                        e.preventDefault()
                        if (overKey !== k) setOverKey(k)
                      }}
                      onDragLeave={() => setOverKey('')}
                      onDrop={(e) => onDrop(e, row, d)}
                      onClick={() =>
                        setForm({ initial: { date: d, driverId: row.kind === 'driver' ? row.driverId : row.kind === 'company' ? row.driverIds[0] : null }, isNew: true })
                      }
                    >
                      {leave && (
                        <div className="leave-tag">
                          休
                          <button className="link small" onClick={(e) => { e.stopPropagation(); update((db) => ({ ...db, leaves: db.leaves.filter((l) => l.id !== leave.id) })) }}>取消</button>
                        </div>
                      )}
                      {jobsIn(row, d).map((j) => renderCard(j, row.kind === 'company'))}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="legend">
        {db.clients.map((c) => <span key={c.id}><i style={{ background: c.color }} />{c.name}</span>)}
      </div>

      {form && (
        <JobForm
          db={db}
          initial={form.initial}
          isNew={form.isNew}
          title={form.title}
          defaultFreq={form.basic ? 'weekdays' : undefined}
          onSave={update}
          onDelete={update}
          onClose={() => setForm(null)}
        />
      )}
      {dayView && <DayView db={db} date={dayView} onClose={() => setDayView(null)} onOpen={(j) => { setDayView(null); setForm({ initial: j, isNew: false }) }} />}
      {leaveOpen && <LeaveForm db={db} onClose={() => setLeaveOpen(false)} onSave={update} />}
      {pick && (
        <Modal title="担当者を選択" onClose={() => setPick(null)}>
          <div className="form">
            <p>{db.companies.find((c) => c.id === pick.companyId)?.name} の誰に割り当てますか？</p>
            <div className="row wrap">
              {db.drivers.filter((d) => d.companyId === pick.companyId).map((d) => (
                <button key={d.id} onClick={() => { moveJob(pick.jobId, pick.date, d.id, pick.copy); setPick(null) }}>{d.displayName}</button>
              ))}
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

function DayView({ db, date, onClose, onOpen }: { db: DB; date: string; onClose: () => void; onOpen: (j: Job) => void }) {
  const jobs = db.jobs.filter((j) => j.date === date)
  const off = db.leaves.filter((l) => l.date === date).map((l) => db.drivers.find((d) => d.id === l.driverId)?.displayName)
  return (
    <Modal title={`${fmtMD(date)} の予定（${jobs.length}件）`} onClose={onClose}>
      {off.length > 0 && <p className="small">休暇：{off.join('、')}</p>}
      <table>
        <thead><tr><th>担当</th><th>請求先</th><th>積み地 → 降ろし地</th><th>台数</th><th>備考</th></tr></thead>
        <tbody>
          {jobs.map((j) => {
            const c = db.clients.find((c) => c.id === j.clientId)
            return (
              <tr key={j.id} className="clickable" onClick={() => onOpen(j)}>
                <td>{db.drivers.find((d) => d.id === j.driverId)?.displayName ?? <b className="danger">未定</b>}</td>
                <td><i className="dot" style={{ background: c?.color }} />{c?.name ?? '—'}</td>
                <td>{j.pickups.filter(Boolean).join('・')} → {j.dropoffs.filter(Boolean).join('・')}</td>
                <td>{j.vehicles}</td>
                <td>{j.note}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </Modal>
  )
}

function LeaveForm({ db, onClose, onSave }: { db: DB; onClose: () => void; onSave: Store['update'] }) {
  const [driverId, setDriverId] = useState('')
  const [from, setFrom] = useState(today())
  const [to, setTo] = useState(today())
  return (
    <Modal title="休暇登録" onClose={onClose}>
      <div className="form">
        <label className="field"><span>ドライバー</span>
          <select value={driverId} onChange={(e) => setDriverId(e.target.value)}><DriverOptions db={db} /></select>
        </label>
        <div className="grid2">
          <label className="field"><span>開始日</span><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="field"><span>終了日</span><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
        <div className="actions">
          <span className="spacer" />
          <button className="ghost" onClick={onClose}>キャンセル</button>
          <button
            onClick={() => {
              if (!driverId) return alert('ドライバーを選択してください')
              const add: Leave[] = []
              for (let d = from; d <= to; d = addDays(d, 1))
                if (!db.leaves.some((l) => l.driverId === driverId && l.date === d)) add.push({ id: uid(), driverId, date: d })
              onSave((db) => ({ ...db, leaves: [...db.leaves, ...add] }))
              onClose()
            }}
          >
            登録
          </button>
        </div>
      </div>
    </Modal>
  )
}
