import { useState, type ReactNode } from 'react'
import type { DB, Job, Memo, RecurRule, SeriesType } from './types'
import { CARD_COLORS, WEEKDAYS, WEEKDAYS_MON_FIRST, emptyJob, recurDates, textColorFor, today, uid } from './store'

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="ghost" onClick={onClose} aria-label="閉じる">✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

/** ドライバー選択肢（所属会社ごとにグループ化） */
export function DriverOptions({ db }: { db: DB }) {
  const solo = db.drivers.filter((d) => d.kind !== 'company')
  return (
    <>
      <option value="">（担当者未定）</option>
      <optgroup label="自社・個人">
        {solo.map((d) => <option key={d.id} value={d.id}>{d.displayName}</option>)}
      </optgroup>
      {db.companies.map((c) => (
        <optgroup key={c.id} label={c.name}>
          {db.drivers.filter((d) => d.companyId === c.id).map((d) => <option key={d.id} value={d.id}>{d.displayName}</option>)}
        </optgroup>
      ))}
    </>
  )
}

function StopList({ label, values, placeholder, onChange }: { label: string; values: string[]; placeholder?: string; onChange: (v: string[]) => void }) {
  const list = values.length ? values : ['']
  return (
    <div className="field">
      <span>{label}</span>
      {list.map((v, i) => (
        <div className="row" key={i}>
          <input value={v} onChange={(e) => onChange(list.map((x, j) => (j === i ? e.target.value : x)))} placeholder={placeholder ?? `${label}${list.length > 1 ? i + 1 : ''}`} />
          {list.length > 1 && <button type="button" className="ghost" onClick={() => onChange(list.filter((_, j) => j !== i))}>−</button>}
        </div>
      ))}
      <button type="button" className="link" onClick={() => onChange([...list, ''])}>＋ {label}を追加</button>
    </div>
  )
}

/** カード色の選択。fallback があれば「指定なし（＝fallback の色）」を選べる */
export function ColorPicker({ value, fallback, onChange }: { value?: string; fallback?: string; onChange: (v: string | undefined) => void }) {
  return (
    <div className="row wrap colors">
      {fallback !== undefined && (
        <button type="button" className={`swatch auto ${!value ? 'on' : ''}`} style={{ background: fallback, color: textColorFor(fallback) }} onClick={() => onChange(undefined)} title="請求先の色を使う">
          自動
        </button>
      )}
      {CARD_COLORS.map((c) => (
        <button type="button" key={c} className={`swatch ${value === c ? 'on' : ''}`} style={{ background: c }} onClick={() => onChange(c)} aria-label={c} />
      ))}
      <input type="color" value={value ?? fallback ?? '#3b82f6'} onChange={(e) => onChange(e.target.value)} title="その他の色" />
    </div>
  )
}

type Scope = 'one' | 'future'
const SHARED_KEYS = ['clientId', 'pickups', 'dropoffs', 'pickupTime', 'dropoffTime', 'note', 'color'] as const
const pickShared = (j: Job) => Object.fromEntries(SHARED_KEYS.map((k) => [k, j[k]])) as Pick<Job, (typeof SHARED_KEYS)[number]>
const SERIES_LABEL: Record<SeriesType, string> = { fixed: '固定業務', regular: '定期案件' }
const DEFAULT_RULE: RecurRule = { freq: 'dow', dows: [1, 2, 3, 4, 5], holidays: false, interval: 1 }

/**
 * 案件の新規作成・編集フォーム。
 * - 繰り返し（固定業務・定期案件）は「1日1件の実体」をシリーズIDでまとめて生成するので、当日だけの担当変更も自由にできる。
 *   編集画面で繰り返し設定を変えると、その日より後のカードを新しい設定で作り直す。
 * - 複数台案件は台数分のカードを作り、グループIDでつなぐ（車両ごとに担当者を割り当てられる）。
 */
export function JobForm({ db, initial, isNew, title, defaultType, onSave, onDelete, onClose }: {
  db: DB
  initial: Partial<Job>
  isNew: boolean
  title?: string
  defaultType?: SeriesType
  onSave: (fn: (db: DB) => DB) => void
  onDelete?: (fn: (db: DB) => DB) => void
  onClose: () => void
}) {
  const [job, setJob] = useState<Job>(() => emptyJob(initial))
  const origType: SeriesType | '' = initial.seriesId ? initial.seriesType ?? 'regular' : ''
  const [seriesType, setSeriesType] = useState<SeriesType | ''>(isNew ? defaultType ?? '' : origType)
  const [rule, setRule] = useState<RecurRule>(initial.seriesRule ?? DEFAULT_RULE)
  const [until, setUntil] = useState(initial.seriesUntil ?? '')
  const [vehicles, setVehicles] = useState(1)
  const [scope, setScope] = useState<Scope>('one')
  const set = <K extends keyof Job>(k: K, v: Job[K]) => setJob((j) => ({ ...j, [k]: v }))
  const original = db.jobs.find((j) => j.id === job.id)
  const inSeries = !isNew && !!job.seriesId

  // 繰り返し設定の変更（編集時）。種類だけの変更はラベルの付け替え、それ以外はこの日より後を作り直す
  const ruleChanged = !isNew && (
    (origType === '') !== (seriesType === '') ||
    (seriesType !== '' && (JSON.stringify(rule) !== JSON.stringify(initial.seriesRule ?? DEFAULT_RULE) || until !== (initial.seriesUntil ?? ''))))
  const typeOnlyChanged = !isNew && !ruleChanged && seriesType !== origType

  // 複数台（編集時）: 同じグループの他車両と、追加予定の車両
  const siblings = isNew || !job.groupId ? [] : db.jobs.filter((j) => j.groupId === job.groupId && j.id !== job.id).sort((a, b) => (a.groupIndex ?? 0) - (b.groupIndex ?? 0))
  const [sibDrivers, setSibDrivers] = useState<Record<string, string | null>>({})
  const [extra, setExtra] = useState<(string | null)[]>([])

  const matchesScope = (j: Job) =>
    j.id === job.id || (scope === 'future' && !!job.seriesId && j.seriesId === job.seriesId && j.date >= (original?.date ?? job.date))

  const validateRule = () => {
    if (!seriesType) return true
    if (rule.freq === 'dow' && !rule.dows.length) return alert('曜日を1つ以上選択してください'), false
    if (until && until < job.date) return alert('終了日は開始日以降を指定してください'), false
    return true
  }
  const seriesMeta = () => (seriesType ? { seriesType, seriesRule: rule, seriesUntil: until } : { seriesType: undefined, seriesRule: undefined, seriesUntil: undefined })

  const save = () => {
    const clean = { ...job, pickups: job.pickups.filter(Boolean), dropoffs: job.dropoffs.filter(Boolean) }
    if (!clean.pickups.length) return alert('積み地（または業務名）を入力してください')
    if (!validateRule()) return

    if (isNew) {
      const dates = seriesType ? recurDates(clean.date, until, rule) : [clean.date]
      if (!dates.length) return alert('条件に合う日がありません')
      const slotSeries = Array.from({ length: vehicles }, () => (seriesType ? uid() : undefined))
      const jobs: Job[] = dates.flatMap((d) => {
        const gid = vehicles > 1 ? uid() : undefined
        return slotSeries.map((sid, k) => ({
          ...clean,
          ...seriesMeta(),
          id: uid(),
          date: d,
          driverId: k === 0 ? clean.driverId : null, // 2台目以降は担当未定で作成
          seriesId: sid,
          groupId: gid,
          groupIndex: gid ? k + 1 : undefined,
        }))
      })
      onSave((db) => ({ ...db, jobs: [...db.jobs, ...jobs] }))
    } else {
      // 日付・シリーズ・グループはその案件固有。それ以外は範囲指定で反映
      const { id: _id, date: _d, seriesId: _s, seriesType: _st, seriesRule: _sr, seriesUntil: _su, groupId: _g, groupIndex: _gi, ...fields } = clean
      const shared = pickShared(clean)
      let gid = clean.groupId
      const add: Job[] = []
      if (extra.length) {
        gid ??= uid()
        const maxIdx = Math.max(1, ...siblings.map((s) => s.groupIndex ?? 0), clean.groupIndex ?? 1)
        extra.forEach((drv, i) => add.push({ ...clean, id: uid(), driverId: drv, seriesId: undefined, groupId: gid, groupIndex: maxIdx + i + 1 }))
      }
      const self = { ...clean, groupId: gid, groupIndex: gid ? clean.groupIndex ?? 1 : undefined }
      onSave((db) => {
        const matched = db.jobs.filter(matchesScope)
        const groups = new Set(matched.map((j) => j.groupId).filter(Boolean))
        let jobs = [
          ...db.jobs.map((j) => {
            if (j.id === self.id) return self
            let n = j
            if (matchesScope(j)) n = { ...n, ...fields }
            else if (j.groupId && groups.has(j.groupId)) n = { ...n, ...shared } // 同じ案件の他車両には共通項目のみ反映
            if (j.id in sibDrivers) n = { ...n, driverId: sibDrivers[j.id] }
            return n
          }),
          ...add,
        ]
        // この日の全車両（複数台なら全台）を繰り返しの「枠」として扱う
        const slots = jobs.filter((j) => j.id === self.id || (gid && j.groupId === gid && j.date === self.date))
        const slotIds = new Set(slots.map((j) => j.id))
        const oldSids = new Set(slots.map((j) => j.seriesId).filter(Boolean))
        if (typeOnlyChanged) {
          jobs = jobs.map((j) => (j.seriesId && oldSids.has(j.seriesId) ? { ...j, seriesType: seriesType || undefined } : j))
        } else if (ruleChanged) {
          // この日より後の旧シリーズを消し、新しい設定で作り直す
          jobs = jobs.filter((j) => !(j.seriesId && oldSids.has(j.seriesId) && j.date > self.date))
          const newSlots = slots.map((j) => ({ ...j, ...seriesMeta(), seriesId: seriesType ? j.seriesId ?? uid() : undefined }))
          jobs = jobs.map((j) => (slotIds.has(j.id) ? newSlots.find((x) => x.id === j.id)! : j))
          if (seriesType) {
            for (const d of recurDates(self.date, until, rule).filter((d) => d > self.date)) {
              const ngid = newSlots.length > 1 ? uid() : undefined
              newSlots.forEach((sl, k) => jobs.push({ ...sl, id: uid(), date: d, groupId: ngid, groupIndex: ngid ? sl.groupIndex ?? k + 1 : undefined }))
            }
          }
        }
        return { ...db, jobs }
      })
    }
    onClose()
  }

  const remove = (wholeGroup: boolean) => {
    const msg = wholeGroup ? `この案件の全${siblings.length + 1}台を削除しますか？` : scope === 'future' ? 'この日以降の同じ繰り返しカードをすべて削除しますか？' : 'この案件を削除しますか？'
    if (!confirm(msg)) return
    onDelete?.((db) => ({ ...db, jobs: db.jobs.filter((j) => !(matchesScope(j) || (wholeGroup && j.groupId === job.groupId))) }))
    onClose()
  }

  const toggleDow = (d: number) => setRule((r) => ({ ...r, dows: r.dows.includes(d) ? r.dows.filter((x) => x !== d) : [...r.dows, d] }))
  const clientColor = db.clients.find((c) => c.id === job.clientId)?.color ?? '#94a3b8'

  return (
    <Modal title={title ?? (isNew ? '案件登録' : '案件編集')} onClose={onClose}>
      <div className="form">
        <div className="grid2">
          <label className="field"><span>日付{isNew && seriesType ? '（開始日）' : ''}</span>
            <input type="date" value={job.date} onChange={(e) => set('date', e.target.value)} />
          </label>
          <label className="field"><span>担当者{isNew ? (vehicles > 1 ? '（1台目）' : '') : siblings.length > 0 || extra.length > 0 ? `（${job.groupIndex ?? 1}台目）` : ''}</span>
            <select value={job.driverId ?? ''} onChange={(e) => set('driverId', e.target.value || null)}>
              <DriverOptions db={db} />
            </select>
          </label>
        </div>
        <label className="field"><span>請求先</span>
          <select value={job.clientId ?? ''} onChange={(e) => set('clientId', e.target.value || null)}>
            <option value="">（未設定）</option>
            {db.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <div className="grid2">
          <StopList label="積み地" placeholder="積み地 または 業務名（例：○○便業務）" values={job.pickups} onChange={(v) => set('pickups', v)} />
          <StopList label="降ろし地" placeholder="降ろし地（空欄可）" values={job.dropoffs} onChange={(v) => set('dropoffs', v)} />
          <label className="field"><span>積み時間</span>
            <input type="time" value={job.pickupTime} onChange={(e) => set('pickupTime', e.target.value)} />
          </label>
          <label className="field"><span>降ろし時間</span>
            <input type="time" value={job.dropoffTime} onChange={(e) => set('dropoffTime', e.target.value)} />
          </label>
        </div>
        <div className="grid3">
          {isNew && (
            <label className="field"><span>台数</span>
              <input type="number" min={1} max={20} value={vehicles} onChange={(e) => setVehicles(Math.min(20, Math.max(1, +e.target.value)))} />
            </label>
          )}
          <label className="field"><span>請求額(円){(isNew ? vehicles > 1 : !!job.groupId) ? ' ※1台あたり' : ''}</span>
            <input type="number" min={0} value={job.billAmount} onChange={(e) => set('billAmount', +e.target.value)} />
          </label>
          <label className="field"><span>支払額(円)</span>
            <input type="number" min={0} value={job.payAmount} onChange={(e) => set('payAmount', +e.target.value)} />
          </label>
        </div>
        <div className="field">
          <span>カードの色（「自動」は請求先の色）</span>
          <ColorPicker value={job.color} fallback={clientColor} onChange={(v) => set('color', v)} />
        </div>
        {isNew && vehicles > 1 && <p className="small muted">台数分のカードを作成します。2台目以降は「担当者未定」に入るので、予定表でドラッグして割り当ててください。</p>}

        {!isNew && (
          <div className="boxed">
            <div className="row">
              <span className="small"><b>{siblings.length + extra.length > 0 ? `複数台案件（全${siblings.length + extra.length + 1}台）` : '台数：1台'}</b></span>
              <span className="spacer" />
              <button type="button" className="link" onClick={() => setExtra([...extra, null])}>＋ 1台追加</button>
            </div>
            {siblings.map((s) => (
              <div className="row" key={s.id}>
                <span className="small nowrap">{s.groupIndex}台目</span>
                <select value={(s.id in sibDrivers ? sibDrivers[s.id] : s.driverId) ?? ''} onChange={(e) => setSibDrivers({ ...sibDrivers, [s.id]: e.target.value || null })}>
                  <DriverOptions db={db} />
                </select>
              </div>
            ))}
            {extra.map((drv, i) => (
              <div className="row" key={`x${i}`}>
                <span className="small nowrap">追加{i + 1}</span>
                <select value={drv ?? ''} onChange={(e) => setExtra(extra.map((x, j) => (j === i ? e.target.value || null : x)))}>
                  <DriverOptions db={db} />
                </select>
                <button type="button" className="ghost" onClick={() => setExtra(extra.filter((_, j) => j !== i))}>−</button>
              </div>
            ))}
            {siblings.length > 0 && <p className="small muted">請求先・積み地・降ろし地・時間・色・備考の変更は、同じ案件の全車両に反映されます。</p>}
          </div>
        )}

        <div className="boxed form">
          <div className="grid2">
            <label className="field"><span>繰り返し</span>
              <select value={seriesType} onChange={(e) => setSeriesType(e.target.value as SeriesType | '')}>
                <option value="">単発</option>
                <option value="regular">定期案件</option>
                <option value="fixed">固定業務</option>
              </select>
            </label>
            {seriesType && (
              <label className="field"><span>頻度</span>
                <select value={rule.freq} onChange={(e) => setRule({ ...rule, freq: e.target.value as RecurRule['freq'] })}>
                  <option value="daily">毎日</option>
                  <option value="dow">曜日選択</option>
                </select>
              </label>
            )}
          </div>
          {seriesType && rule.freq === 'dow' && (
            <>
              <div className="row wrap dows">
                {WEEKDAYS_MON_FIRST.map((d) => (
                  <label key={d} className={`chip ${rule.dows.includes(d) ? 'on' : ''}`}>
                    <input type="checkbox" checked={rule.dows.includes(d)} onChange={() => toggleDow(d)} />{WEEKDAYS[d]}
                  </label>
                ))}
              </div>
              <div className="row wrap">
                <span className="small">繰り返し：</span>
                <label className="inline"><input type="radio" checked={rule.interval === 1} onChange={() => setRule({ ...rule, interval: 1 })} />毎週</label>
                <label className="inline"><input type="radio" checked={rule.interval === 2} onChange={() => setRule({ ...rule, interval: 2 })} />隔週</label>
                <label className="inline"><input type="radio" checked={rule.interval === 0} onChange={() => setRule({ ...rule, interval: 0 })} />開始日の週のみ</label>
              </div>
            </>
          )}
          {seriesType && !(rule.freq === 'dow' && rule.interval === 0) && (
            <label className="field"><span>終了日（空欄＝未定。1年先まで作成）</span>
              <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
            </label>
          )}
          {seriesType && (
            <label className="inline"><input type="checkbox" checked={rule.holidays} onChange={(e) => setRule({ ...rule, holidays: e.target.checked })} />祝日も稼働する（オフの場合、祝日はカードを作りません）</label>
          )}
          {ruleChanged && (
            <p className="small warn-text">
              保存すると、この日より後の繰り返しカードを{seriesType ? '新しい設定で作り直します' : '削除し、この日だけの単発案件にします'}（この日より後に個別で変更した内容はリセットされます）。
            </p>
          )}
          {typeOnlyChanged && seriesType && <p className="small muted">このシリーズのカードをすべて「{SERIES_LABEL[seriesType]}」に変更します。</p>}
        </div>

        <label className="field"><span>備考</span>
          <textarea rows={2} value={job.note} onChange={(e) => set('note', e.target.value)} />
        </label>

        {inSeries && !ruleChanged && (
          <div className="boxed">
            <span className="small">この案件は{SERIES_LABEL[origType || 'regular']}です。変更の反映範囲：</span>
            <label className="inline"><input type="radio" checked={scope === 'one'} onChange={() => setScope('one')} />この日のみ</label>
            <label className="inline"><input type="radio" checked={scope === 'future'} onChange={() => setScope('future')} />この日以降すべて</label>
          </div>
        )}

        <div className="actions">
          {!isNew && onDelete && (
            <>
              <button className="danger-btn" onClick={() => remove(false)}>{siblings.length ? 'この車両を削除' : '削除'}</button>
              {siblings.length > 0 && scope === 'one' && <button className="danger-btn" onClick={() => remove(true)}>全台削除</button>}
            </>
          )}
          <span className="spacer" />
          <button className="ghost" onClick={onClose}>キャンセル</button>
          <button onClick={save}>保存</button>
        </div>
      </div>
    </Modal>
  )
}

/** メモ用カードの登録・編集 */
export function MemoForm({ db, initial, onSave, onClose }: { db: DB; initial: Partial<Memo>; onSave: (fn: (db: DB) => DB) => void; onClose: () => void }) {
  const [m, setM] = useState<Memo>(() => ({ id: uid(), date: today(), driverId: null, time: '', text: '', color: '#fde68a', ...initial }))
  const set = <K extends keyof Memo>(k: K, v: Memo[K]) => setM((x) => ({ ...x, [k]: v }))
  const exists = db.memos.some((x) => x.id === m.id)
  return (
    <Modal title={exists ? 'メモ編集' : 'メモ追加'} onClose={onClose}>
      <div className="form">
        <div className="grid3">
          <label className="field"><span>日付</span><input type="date" value={m.date} onChange={(e) => set('date', e.target.value)} /></label>
          <label className="field"><span>担当者（未定＝一番上の行）</span>
            <select value={m.driverId ?? ''} onChange={(e) => set('driverId', e.target.value || null)}><DriverOptions db={db} /></select>
          </label>
          <label className="field"><span>時間（任意）</span><input type="time" value={m.time} onChange={(e) => set('time', e.target.value)} /></label>
        </div>
        <label className="field"><span>内容</span>
          <textarea rows={3} value={m.text} onChange={(e) => set('text', e.target.value)} autoFocus />
        </label>
        <div className="field"><span>カードの色</span><ColorPicker value={m.color} onChange={(v) => set('color', v ?? '#fde68a')} /></div>
        <div className="actions">
          {exists && (
            <button className="danger-btn" onClick={() => {
              if (!confirm('このメモを削除しますか？')) return
              onSave((db) => ({ ...db, memos: db.memos.filter((x) => x.id !== m.id) }))
              onClose()
            }}>削除</button>
          )}
          <span className="spacer" />
          <button className="ghost" onClick={onClose}>キャンセル</button>
          <button onClick={() => {
            if (!m.text.trim()) return alert('内容を入力してください')
            onSave((db) => ({ ...db, memos: exists ? db.memos.map((x) => (x.id === m.id ? m : x)) : [...db.memos, m] }))
            onClose()
          }}>保存</button>
        </div>
      </div>
    </Modal>
  )
}
