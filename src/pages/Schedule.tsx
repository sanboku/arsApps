import { useEffect, useMemo, useRef, useState } from 'react'
import type { Store } from '../store'
import { addDays, byTime, fmtMD, holidayName, isPM, leaveCount, monthDays, orderedRowKeys, parseYmd, routeText, textColorFor, today, uid, weekStart, ymd } from '../store'
import type { DB, Job, Leave, Memo } from '../types'
import { JobForm, MemoForm, Modal } from '../components'

type Row =
  | { kind: 'none'; key: string; label: string }
  | { kind: 'driver'; key: string; label: string; driverId: string }
  | { kind: 'company'; key: string; label: string; companyId: string; driverIds: string[] }

/** 検索条件。driverId は ''=すべて / 'none'=担当者未定 / ID */
type Search = { q: string; driverId: string; clientId: string; type: '' | 'single' | 'regular' | 'fixed' | 'memo'; from: string; to: string }
const EMPTY_SEARCH: Search = { q: '', driverId: '', clientId: '', type: '', from: '', to: '' }

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
  const [leaveFor, setLeaveFor] = useState<Row | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [search, setSearch] = useState<Search>(EMPTY_SEARCH)
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
    // 並び順はドライバー管理画面の「予定表の表示順」で設定
    const r: Row[] = [{ kind: 'none', key: 'none', label: '担当者未定' }]
    for (const key of orderedRowKeys(db)) {
      const [t, id] = key.split(':')
      if (t === 'd') {
        const d = db.drivers.find((x) => x.id === id)!
        if (visible(d.id)) r.push({ kind: 'driver', key: d.id, label: d.displayName, driverId: d.id })
      } else {
        const c = db.companies.find((x) => x.id === id)!
        const ids = db.drivers.filter((d) => d.companyId === c.id && visible(d.id)).map((d) => d.id)
        if (ids.length) r.push({ kind: 'company', key: c.id, label: c.name, companyId: c.id, driverIds: ids })
      }
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
  const clientOf = (j: Job) => db.clients.find((c) => c.id === j.clientId)
  const driverOf = (id: string | null) => db.drivers.find((d) => d.id === id)
  const leavesIn = (row: Row, date: string) =>
    row.kind === 'none' ? [] : db.leaves.filter((l) => l.date === date && (row.kind === 'driver' ? l.driverId === row.driverId : row.driverIds.includes(l.driverId)))

  // 検索・フィルター
  const searchActive = JSON.stringify(search) !== JSON.stringify(EMPTY_SEARCH)
  const matchCommon = (date: string, driverId: string | null) =>
    (!search.from || date >= search.from) && (!search.to || date <= search.to) &&
    (!search.driverId || (search.driverId === 'none' ? !driverId : driverId === search.driverId))
  const matchJob = (j: Job) => {
    if (!matchCommon(j.date, j.driverId)) return false
    if (search.clientId && j.clientId !== search.clientId) return false
    if (search.type === 'memo') return false
    if (search.type === 'single' && j.seriesId) return false
    if ((search.type === 'regular' || search.type === 'fixed') && (!j.seriesId || (j.seriesType ?? 'regular') !== search.type)) return false
    if (!search.q) return true
    const hay = [...j.pickups, ...j.dropoffs, j.note, db.clients.find((c) => c.id === j.clientId)?.name, driverOf(j.driverId)?.displayName, driverOf(j.driverId)?.fullName].join(' ')
    return hay.toLowerCase().includes(search.q.toLowerCase())
  }
  const matchMemo = (m: Memo) =>
    matchCommon(m.date, m.driverId) && !search.clientId && (!search.type || search.type === 'memo') &&
    (!search.q || `${m.text} ${driverOf(m.driverId)?.displayName ?? ''}`.toLowerCase().includes(search.q.toLowerCase()))
  const results = searchActive
    ? [
        ...db.jobs.filter(matchJob).map((j) => ({ kind: 'job' as const, j, date: j.date, time: j.pickupTime || j.dropoffTime })),
        ...db.memos.filter(matchMemo).map((m) => ({ kind: 'memo' as const, m, date: m.date, time: m.time })),
      ].sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))
    : []

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
    // 休暇日への案件の割り当ては確認する
    const target = row.kind === 'driver' ? row.driverId : row.kind === 'company' && item.driverId && row.driverIds.includes(item.driverId) ? item.driverId : null
    if (kind === 'job' && target && db.leaves.some((l) => l.driverId === target && l.date === date) && !confirm(`${driverOf(target)?.displayName} さんは ${fmtMD(date)} が休暇です。割り当てますか？`)) return
    if (row.kind === 'none') moveItem(key, date, null, copy)
    else if (row.kind === 'driver') moveItem(key, date, row.driverId, copy)
    else if (item.driverId && row.driverIds.includes(item.driverId)) moveItem(key, date, item.driverId, copy)
    else setPick({ key, date, companyId: row.companyId, copy }) // 会社行へのドロップは担当者を選ぶ
  }


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
        className={`job ${j.groupId && hoverGroup === j.groupId ? 'linked' : ''} ${searchActive && !matchJob(j) ? 'dim' : ''}`}
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
      className={`job memo ${searchActive && !matchMemo(m) ? 'dim' : ''}`}
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
          <button className={searchActive ? '' : 'secondary'} onClick={() => setSearchOpen(!searchOpen)}>🔍 検索{searchActive ? `（${results.length}件）` : ''}</button>
          <label className="inline small"><input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} />非表示ドライバーも表示</label>
        </div>
      </div>
      <p className="muted small">カードをドラッグで日付・担当を変更（Ctrl/Option を押しながらでコピー）。各ドライバーは上段＝AM・下段＝PM（時間未設定はAM）。ドライバー名の「＋」で案件登録、「休」で休暇登録。日付をクリックでその日の一覧。</p>

      {searchOpen && (
        <div className="card search-panel">
          <div className="search-grid">
            <input placeholder="キーワード（積み地・降ろし地・備考・請求先・担当者・メモ）" value={search.q} onChange={(e) => setSearch({ ...search, q: e.target.value })} autoFocus />
            <select value={search.driverId} onChange={(e) => setSearch({ ...search, driverId: e.target.value })}>
              <option value="">担当者：すべて</option>
              <option value="none">担当者未定</option>
              {db.drivers.map((d) => <option key={d.id} value={d.id}>{d.displayName}</option>)}
            </select>
            <select value={search.clientId} onChange={(e) => setSearch({ ...search, clientId: e.target.value })}>
              <option value="">請求先：すべて</option>
              {db.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={search.type} onChange={(e) => setSearch({ ...search, type: e.target.value as Search['type'] })}>
              <option value="">種類：すべて</option>
              <option value="single">単発</option>
              <option value="regular">定期案件</option>
              <option value="fixed">固定業務</option>
              <option value="memo">メモ</option>
            </select>
            <div className="row">
              <input type="date" value={search.from} onChange={(e) => setSearch({ ...search, from: e.target.value })} title="期間（から）" />
              〜
              <input type="date" value={search.to} onChange={(e) => setSearch({ ...search, to: e.target.value })} title="期間（まで）" />
            </div>
            <button className="ghost" onClick={() => setSearch(EMPTY_SEARCH)}>クリア</button>
          </div>
          {searchActive && (
            <>
              <p className="small muted">{results.length}件ヒット（予定表では該当しないカードが薄く表示されます）。行をクリックでその日へ移動して開きます。</p>
              <div className="search-results">
                <table>
                  <tbody>
                    {results.slice(0, 200).map((r) => (
                      <tr
                        key={r.kind === 'job' ? r.j.id : r.m.id}
                        className="clickable"
                        onClick={() => {
                          setCursor(r.date)
                          if (r.kind === 'job') setForm({ initial: r.j, isNew: false })
                          else setMemoForm(r.m)
                        }}
                      >
                        <td className="nowrap">{fmtMD(r.date)}</td>
                        <td className="nowrap">{r.time || '—'}</td>
                        <td className="nowrap">{driverOf(r.kind === 'job' ? r.j.driverId : r.m.driverId)?.displayName ?? '未定'}</td>
                        {r.kind === 'job' ? (
                          <>
                            <td className="nowrap"><i className="dot" style={{ background: r.j.color ?? clientOf(r.j)?.color }} />{clientOf(r.j)?.name ?? '—'}</td>
                            <td>{r.j.seriesId ? (r.j.seriesType === 'fixed' ? '📌 ' : '🔁 ') : ''}{routeText(r.j)}</td>
                          </>
                        ) : (
                          <td colSpan={2}>📝 {r.m.text}</td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {results.length > 200 && <p className="small muted">先頭200件を表示しています。条件を絞り込んでください。</p>}
              </div>
            </>
          )}
        </div>
      )}

      <div className="sched-wrap" ref={wrapRef}>
        <table className={`sched ${mode}`} style={mode === 'month' ? { minWidth: 200 + days.length * 104 } : undefined}>
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
                        {row.kind !== 'none' && (
                          <button className="add-btn leave-btn" title="休暇を登録" onClick={() => setLeaveFor(row)}>休</button>
                        )}
                        <button
                          className="add-btn"
                          title="この担当で案件を追加"
                          onClick={() => setForm({ initial: { date: defaultDate(), driverId: row.kind === 'driver' ? row.driverId : row.kind === 'company' ? row.driverIds[0] : null }, isNew: true })}
                        >
                          ＋
                        </button>
                      </div>
                      {row.kind === 'driver' && driverOf(row.driverId)?.kind === 'employee' && (
                        <div className="leave-count" title="社員の月間休暇日数">
                          {parseYmd(cursor).getMonth() + 1}月 休暇 {leaveCount(db, row.driverId, cursor.slice(0, 7))}日
                        </div>
                      )}
                    </th>
                  )}
                  <th className="sticky2">{half === 'am' ? 'AM' : 'PM'}</th>
                  {days.map((d) => {
                    const leaves = leavesIn(row, d)
                    const leave = row.kind === 'driver' ? leaves[0] : undefined
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
                        {half === 'am' && leaves.map((l) => (
                          <div className="leave-tag" key={l.id}>
                            休{row.kind === 'company' && ` ${driverOf(l.driverId)?.displayName}`}
                            <button className="link small" onClick={(e) => { e.stopPropagation(); update((db) => ({ ...db, leaves: db.leaves.filter((x) => x.id !== l.id) })) }}>取消</button>
                          </div>
                        ))}
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
      {leaveFor && leaveFor.kind !== 'none' && (
        <LeaveForm
          db={db}
          driverIds={leaveFor.kind === 'driver' ? [leaveFor.driverId] : leaveFor.driverIds}
          title={leaveFor.label}
          defaultDate={defaultDate()}
          onClose={() => setLeaveFor(null)}
          onSave={update}
        />
      )}
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

/**
 * 休暇登録（ドライバー欄の「休」から開く）。
 * 案件が割り振られている日には休暇を登録できない。
 */
function LeaveForm({ db, driverIds, title, defaultDate, onClose, onSave }: {
  db: DB
  driverIds: string[]
  title: string
  defaultDate: string
  onClose: () => void
  onSave: Store['update']
}) {
  const [driverId, setDriverId] = useState(driverIds.length === 1 ? driverIds[0] : '')
  const [from, setFrom] = useState(defaultDate)
  const [to, setTo] = useState(defaultDate)
  const name = (id: string) => db.drivers.find((d) => d.id === id)?.displayName
  const upcoming = db.leaves.filter((l) => driverIds.includes(l.driverId) && l.date >= addDays(today(), -31)).sort((a, b) => a.date.localeCompare(b.date))
  return (
    <Modal title={`休暇登録：${title}`} onClose={onClose}>
      <div className="form">
        {driverIds.length > 1 && (
          <label className="field"><span>ドライバー</span>
            <select value={driverId} onChange={(e) => setDriverId(e.target.value)}>
              <option value="">選択してください</option>
              {driverIds.map((id) => <option key={id} value={id}>{name(id)}</option>)}
            </select>
          </label>
        )}
        <div className="grid2">
          <label className="field"><span>開始日</span><input type="date" value={from} onChange={(e) => { setFrom(e.target.value); if (e.target.value > to) setTo(e.target.value) }} /></label>
          <label className="field"><span>終了日</span><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
        <div className="actions">
          <span className="spacer" />
          <button className="ghost" onClick={onClose}>閉じる</button>
          <button
            onClick={() => {
              if (!driverId) return alert('ドライバーを選択してください')
              if (!from || !to || to < from) return alert('期間を正しく指定してください')
              const busy: string[] = []
              const add: Leave[] = []
              for (let d = from; d <= to; d = addDays(d, 1)) {
                if (db.jobs.some((j) => j.driverId === driverId && j.date === d)) busy.push(fmtMD(d))
                else if (!db.leaves.some((l) => l.driverId === driverId && l.date === d)) add.push({ id: uid(), driverId, date: d })
              }
              if (busy.length) return alert(`次の日は案件が割り振られているため休暇を登録できません。\n先に案件の担当を変更してください。\n\n${busy.join('、')}`)
              onSave((db) => ({ ...db, leaves: [...db.leaves, ...add] }))
              onClose()
            }}
          >
            登録
          </button>
        </div>
        {upcoming.length > 0 && (
          <div className="boxed">
            <span className="small"><b>登録済みの休暇</b></span>
            <ul className="list small">
              {upcoming.map((l) => (
                <li key={l.id}>
                  {fmtMD(l.date)}{driverIds.length > 1 && ` ${name(l.driverId)}`}
                  <button className="link small" onClick={() => onSave((db) => ({ ...db, leaves: db.leaves.filter((x) => x.id !== l.id) }))}>　取消</button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  )
}
