import { useEffect, useMemo, useRef, useState } from 'react'
import type { Store } from '../store'
import { addDays, byTime, fmtMD, holidayName, isPM, monthDays, parseYmd, routeText, textColorFor, today, uid, weekStart, ymd } from '../store'
import type { DB, Job, Leave, Memo } from '../types'
import { DriverOptions, JobForm, MemoForm, Modal } from '../components'

type Row =
  | { kind: 'none'; key: string; label: string }
  | { kind: 'driver'; key: string; label: string; driverId: string }
  | { kind: 'company'; key: string; label: string; companyId: string; driverIds: string[] }

type FormState = { initial: Partial<Job>; isNew: boolean; title?: string; fixed?: boolean }
/** セルに並ぶもの：案件カード or メモカード */
type Item = { kind: 'job'; j: Job; time: string } | { kind: 'memo'; m: Memo; time: string }
type Mode = 'week' | 'month'

export default function Schedule({ store }: { store: Store }) {
  const { db, update } = store
  const [mode, setMode] = useState<Mode>('week')
  const [cursor, setCursor] = useState(today) // 表示中の基準日
  const [form, setForm] = useState<FormState | null>(null)
  const [dayView, setDayView] = useState<string | null>(null)
  const [leaveOpen, setLeaveOpen] = useState(false)
  const [showHidden, setShowHidden] = useState(false)
  const [memoForm, setMemoForm] = useState<Partial<Memo> | null>(null)
  const [pick, setPick] = useState<{ key: string; date: string; companyId: string; copy: boolean } | null>(null)
  const [overKey, setOverKey] = useState('')
  const [hoverGroup, setHoverGroup] = useState<string | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const days = mode === 'week' ? Array.from({ length: 7 }, (_, i) => addDays(weekStart(cursor), i)) : monthDays(cursor)
  const start = days[0]
  const end = days[days.length - 1]
  const rangeJobs = db.jobs.filter((j) => j.date >= start && j.date <= end)
  const rangeMemos = db.memos.filter((m) => m.date >= start && m.date <= end)
  const busy = new Set([...rangeJobs.map((j) => j.driverId), ...rangeMemos.map((m) => m.driverId)])
  const visible = (id: string) => showHidden || busy.has(id) || db.drivers.find((d) => d.id === id)?.showOnCalendar

  // 複数台案件の「何台目/全何台」
  const groupInfo = useMemo(() => {
    const m = new Map<string, Job[]>()
    for (const j of db.jobs) if (j.groupId) m.set(j.groupId, [...(m.get(j.groupId) ?? []), j])
    return m
  }, [db.jobs])

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
  }, [db, start, end, showHidden])

  // 表示範囲に今日が含まれていれば、今日の列が見える位置までスクロール
  useEffect(() => {
    const wrap = wrapRef.current
    const el = wrap?.querySelector<HTMLElement>('th.today')
    if (!wrap) return
    if (!el) return void (wrap.scrollLeft = 0)
    const sticky = wrap.querySelector<HTMLElement>('th.sticky')?.offsetWidth ?? 0
    wrap.scrollLeft = Math.max(0, el.offsetLeft - sticky - 8)
  }, [mode, start])

  const inRow = (row: Row, driverId: string | null) =>
    row.kind === 'none' ? !driverId : row.kind === 'driver' ? driverId === row.driverId : row.driverIds.includes(driverId ?? '')
  /** セル内の案件とメモ（時間の早い順、時間未設定は先頭） */
  const itemsIn = (row: Row, date: string): Item[] => {
    const jobs = rangeJobs.filter((j) => j.date === date && inRow(row, j.driverId)).sort(byTime)
    const memos = rangeMemos.filter((m) => m.date === date && inRow(row, m.driverId))
    return [
      ...jobs.map((j) => ({ kind: 'job' as const, j, time: j.pickupTime || j.dropoffTime })),
      ...memos.map((m) => ({ kind: 'memo' as const, m, time: m.time })),
    ].sort((a, b) => a.time.localeCompare(b.time))
  }
  const itemIsPM = (it: Item) => (it.kind === 'job' ? isPM(it.j) : it.time >= '12:00')
  const leaveOf = (driverId: string, date: string) => db.leaves.find((l) => l.driverId === driverId && l.date === date)

  /** ドロップ時の処理。key は "job:ID" または "memo:ID"。Ctrlキー（MacはOption）押しながらでコピー */
  const moveItem = (key: string, date: string, driverId: string | null, copy: boolean) =>
    update((db) => {
      const [kind, id] = key.split(':')
      if (kind === 'memo') {
        const m = db.memos.find((x) => x.id === id)
        if (!m) return db
        if (copy) return { ...db, memos: [...db.memos, { ...m, id: uid(), date, driverId }] }
        return { ...db, memos: db.memos.map((x) => (x.id === id ? { ...x, date, driverId } : x)) }
      }
      const jobId = id
      const src = db.jobs.find((j) => j.id === jobId)
      if (!src) return db
      if (copy) return { ...db, jobs: [...db.jobs, { ...src, id: uid(), date, driverId, seriesId: undefined, seriesType: undefined, seriesRule: undefined, seriesUntil: undefined, groupId: undefined, groupIndex: undefined }] }
      return { ...db, jobs: db.jobs.map((j) => (j.id === jobId ? { ...j, date, driverId } : j)) }
    })

  const onDrop = (e: React.DragEvent, row: Row, date: string) => {
    e.preventDefault()
    setOverKey('')
    setHoverGroup(null)
    const key = e.dataTransfer.getData('text/plain')
    const copy = e.ctrlKey || e.altKey
    const [kind, id] = key.split(':')
    const item = kind === 'memo' ? db.memos.find((m) => m.id === id) : db.jobs.find((j) => j.id === id)
    if (!item) return
    if (row.kind === 'none') moveItem(key, date, null, copy)
    else if (row.kind === 'driver') moveItem(key, date, row.driverId, copy)
    else if (item.driverId && row.driverIds.includes(item.driverId)) moveItem(key, date, item.driverId, copy)
    else setPick({ key, date, companyId: row.companyId, copy }) // 会社行へのドロップは担当者を選ぶ
  }

  const clientOf = (j: Job) => db.clients.find((c) => c.id === j.clientId)
  const driverOf = (id: string | null) => db.drivers.find((d) => d.id === id)

  // コンポーネント化するとドラッグ中の再描画で要素が作り直されるため、関数として描画する
  const renderCard = (j: Job, showDriver: boolean) => {
    const c = clientOf(j)
    const group = j.groupId ? groupInfo.get(j.groupId) ?? [] : []
    const gNo = group.length > 1 ? [...group].sort((a, b) => (a.groupIndex ?? 0) - (b.groupIndex ?? 0)).findIndex((x) => x.id === j.id) + 1 : 0
    const time = [j.pickupTime, j.dropoffTime].filter(Boolean).join('〜')
    const text = mode === 'month' ? j.pickups.filter(Boolean)[0] ?? '—' : routeText(j)
    const bg = j.color ?? c?.color ?? '#94a3b8'
    return (
      <div
        key={j.id}
        className={`job ${j.groupId && hoverGroup === j.groupId ? 'linked' : ''}`}
        draggable
        style={{ background: bg, color: textColorFor(bg) }}
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', `job:${j.id}`)
          e.dataTransfer.effectAllowed = 'copyMove'
        }}
        onMouseEnter={() => j.groupId && setHoverGroup(j.groupId)}
        onMouseLeave={() => setHoverGroup(null)}
        onClick={(e) => {
          e.stopPropagation()
          setForm({ initial: j, isNew: false })
        }}
        title={[c?.name ?? '請求先未設定', time && `時間: ${time}`, routeText(j), j.note].filter(Boolean).join('\n')}
      >
        {showDriver && <span className="job-driver">{driverOf(j.driverId)?.displayName}</span>}
        {gNo > 0 && <span className="badge" title="複数台案件">{mode === 'week' && '🚚'}{gNo}/{group.length}</span>}
        {j.seriesId && mode === 'week' && (j.seriesType === 'fixed' ? <span className="job-icon" title="固定業務">📌</span> : <span className="job-icon" title="定期案件">🔁</span>)}
        <span className="job-text">{text}</span>
      </div>
    )
  }

  const renderMemo = (m: Memo, showDriver: boolean) => (
    <div
      key={m.id}
      className="job memo"
      draggable
      style={{ background: m.color, color: textColorFor(m.color) }}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', `memo:${m.id}`)
        e.dataTransfer.effectAllowed = 'copyMove'
      }}
      onClick={(e) => {
        e.stopPropagation()
        setMemoForm(m)
      }}
      title={[m.time && `時間: ${m.time}`, m.text].filter(Boolean).join('\n')}
    >
      {showDriver && m.driverId && <span className="job-driver">{driverOf(m.driverId)?.displayName}</span>}
      <span className="job-icon">📝</span>
      <span className="job-text">{m.text}</span>
    </div>
  )
  const renderItem = (it: Item, showDriver: boolean) => (it.kind === 'job' ? renderCard(it.j, showDriver) : renderMemo(it.m, showDriver))
  /** 新規登録の初期日付：表示範囲に今日があれば今日、なければ範囲の初日 */
  const defaultDate = () => (start <= today() && today() <= end ? today() : start)

  const move = (n: number) => {
    if (mode === 'week') return setCursor(addDays(cursor, 7 * n))
    const d = parseYmd(cursor)
    setCursor(ymd(new Date(d.getFullYear(), d.getMonth() + n, 1)))
  }
  const title = mode === 'week' ? `${fmtMD(start)} 〜 ${fmtMD(end)}` : `${parseYmd(cursor).getFullYear()}年${parseYmd(cursor).getMonth() + 1}月`

  return (
    <div className="page wide">
      <div className="toolbar">
        <h2>案件予定表</h2>
        <div className="seg">
          <button className={mode === 'week' ? 'on' : ''} onClick={() => setMode('week')}>週</button>
          <button className={mode === 'month' ? 'on' : ''} onClick={() => setMode('month')}>月</button>
        </div>
        <div className="row">
          <button className="ghost" onClick={() => move(-1)}>◀</button>
          <button className="ghost today-btn" onClick={() => setCursor(today())}>今日</button>
          <button className="ghost" onClick={() => move(1)}>▶</button>
          <b className="range-title">{title}</b>
          <input type="date" value={cursor} onChange={(e) => e.target.value && setCursor(e.target.value)} />
        </div>
        <div className="row">
          <button onClick={() => setForm({ initial: { date: defaultDate() }, isNew: true })}>＋ 案件登録</button>
          <button className="secondary" onClick={() => setForm({ initial: { date: defaultDate() }, isNew: true, title: '固定業務登録（毎日固定の担当）', fixed: true })}>固定業務登録</button>
          <button className="secondary" onClick={() => setMemoForm({ date: defaultDate() })}>📝 メモ追加</button>
          <button className="secondary" onClick={() => setLeaveOpen(true)}>休暇登録</button>
          <label className="inline small"><input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} />非表示ドライバーも表示</label>
        </div>
      </div>
      <p className="muted small">カードをドラッグで日付・担当を変更（Ctrl/Option を押しながらでコピー）。各ドライバーは上段＝AM・下段＝PM（時間未設定はAM）。空きマスまたはドライバー名の「＋」で案件登録、日付をクリックでその日の一覧。</p>

      <div className="sched-wrap" ref={wrapRef}>
        <table className={`sched ${mode}`} style={mode === 'month' ? { minWidth: 180 + days.length * 104 } : undefined}>
          <colgroup>
            <col className="c-name" />
            <col className="c-half" />
            {days.map((d) => <col key={d} />)}
          </colgroup>
          <thead>
            <tr>
              <th className="sticky" colSpan={2}>ドライバー</th>
              {days.map((d) => {
                const dow = parseYmd(d).getDay()
                const hol = holidayName(d)
                return (
                  <th key={d} className={`day ${d === today() ? 'today' : ''} ${dow === 0 || hol ? 'sun' : dow === 6 ? 'sat' : ''}`} onClick={() => setDayView(d)} title={hol}>
                    {fmtMD(d)}
                    {hol && <div className="hol">{hol}</div>}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) =>
              (['am', 'pm'] as const).map((half) => (
                <tr key={`${row.key}_${half}`} className={`${half} ${row.kind === 'none' ? 'row-none' : row.kind === 'company' ? 'row-company' : ''}`}>
                  {half === 'am' && (
                    <th className="sticky" rowSpan={2} title={row.kind === 'company' ? `${row.label}（${row.driverIds.length}名）` : row.label}>
                      <div className="row-head">
                        <span className="row-name">{row.label}</span>
                        <button
                          className="add-btn"
                          title="この担当で案件を追加"
                          onClick={() => setForm({ initial: { date: defaultDate(), driverId: row.kind === 'driver' ? row.driverId : row.kind === 'company' ? row.driverIds[0] : null }, isNew: true })}
                        >
                          ＋
                        </button>
                      </div>
                    </th>
                  )}
                  <th className="sticky2">{half === 'am' ? 'AM' : 'PM'}</th>
                  {days.map((d) => {
                    const leave = row.kind === 'driver' ? leaveOf(row.driverId, d) : undefined
                    const k = `${row.key}_${half}_${d}`
                    const list = itemsIn(row, d).filter((it) => itemIsPM(it) === (half === 'pm'))
                    return (
                      <td
                        key={d}
                        className={`${leave ? 'leave' : ''} ${overKey === k ? 'over' : ''} ${d === today() ? 'today-col' : ''}`}
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
                        {leave && half === 'am' && (
                          <div className="leave-tag">
                            休
                            <button className="link small" onClick={(e) => { e.stopPropagation(); update((db) => ({ ...db, leaves: db.leaves.filter((l) => l.id !== leave.id) })) }}>取消</button>
                          </div>
                        )}
                        {list.map((it) => renderItem(it, row.kind === 'company'))}
                      </td>
                    )
                  })}
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>

      <div className="legend">
        {db.clients.map((c) => <span key={c.id}><i style={{ background: c.color }} />{c.name}</span>)}
        <span className="muted">📌 固定業務　🔁 定期案件　📝 メモ　🚚2/3 = 複数台案件の2台目（全3台）・マウスを乗せると同じ案件の車両を強調</span>
      </div>

      {form && (
        <JobForm
          db={db}
          initial={form.initial}
          isNew={form.isNew}
          title={form.title}
          defaultType={form.fixed ? 'fixed' : undefined}
          onSave={update}
          onDelete={update}
          onClose={() => setForm(null)}
        />
      )}
      {dayView && <DayView db={db} date={dayView} onClose={() => setDayView(null)} onOpen={(j) => { setDayView(null); setForm({ initial: j, isNew: false }) }} />}
      {memoForm && <MemoForm db={db} initial={memoForm} onSave={update} onClose={() => setMemoForm(null)} />}
      {leaveOpen && <LeaveForm db={db} onClose={() => setLeaveOpen(false)} onSave={update} />}
      {pick && (
        <Modal title="担当者を選択" onClose={() => setPick(null)}>
          <div className="form">
            <p>{db.companies.find((c) => c.id === pick.companyId)?.name} の誰に割り当てますか？</p>
            <div className="row wrap">
              {db.drivers.filter((d) => d.companyId === pick.companyId).map((d) => (
                <button key={d.id} onClick={() => { moveItem(pick.key, pick.date, d.id, pick.copy); setPick(null) }}>{d.displayName}</button>
              ))}
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

function DayView({ db, date, onClose, onOpen }: { db: DB; date: string; onClose: () => void; onOpen: (j: Job) => void }) {
  const jobs = db.jobs.filter((j) => j.date === date).sort(byTime)
  const off = db.leaves.filter((l) => l.date === date).map((l) => db.drivers.find((d) => d.id === l.driverId)?.displayName)
  const memos = db.memos.filter((m) => m.date === date).sort((a, b) => a.time.localeCompare(b.time))
  return (
    <Modal title={`${fmtMD(date)} の予定（${jobs.length}件）`} onClose={onClose}>
      {off.length > 0 && <p className="small">休暇：{off.join('、')}</p>}
      {memos.length > 0 && (
        <ul className="list small">
          {memos.map((m) => (
            <li key={m.id}><i className="dot" style={{ background: m.color }} />📝 {m.time && `${m.time} `}{m.driverId ? `[${db.drivers.find((d) => d.id === m.driverId)?.displayName}] ` : ''}{m.text}</li>
          ))}
        </ul>
      )}
      <table>
        <thead><tr><th>時間</th><th>担当</th><th>請求先</th><th>内容</th><th>備考</th></tr></thead>
        <tbody>
          {jobs.map((j) => {
            const c = db.clients.find((c) => c.id === j.clientId)
            return (
              <tr key={j.id} className="clickable" onClick={() => onOpen(j)}>
                <td className="nowrap">{[j.pickupTime, j.dropoffTime].filter(Boolean).join('〜') || '—'}</td>
                <td>{db.drivers.find((d) => d.id === j.driverId)?.displayName ?? <b className="danger">未定</b>}</td>
                <td><i className="dot" style={{ background: c?.color }} />{c?.name ?? '—'}</td>
                <td>{routeText(j)}{j.groupId && <span className="small muted">（複数台）</span>}</td>
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
