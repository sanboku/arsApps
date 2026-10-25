import { useState, type ReactNode } from 'react'
import type { DB, Job, RecurFreq } from './types'
import { emptyJob, recurDates, uid } from './store'

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

function StopList({ label, values, onChange }: { label: string; values: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="field">
      <span>{label}</span>
      {values.map((v, i) => (
        <div className="row" key={i}>
          <input value={v} onChange={(e) => onChange(values.map((x, j) => (j === i ? e.target.value : x)))} placeholder={`${label}${values.length > 1 ? i + 1 : ''}`} />
          {values.length > 1 && <button type="button" className="ghost" onClick={() => onChange(values.filter((_, j) => j !== i))}>−</button>}
        </div>
      ))}
      <button type="button" className="link" onClick={() => onChange([...values, ''])}>＋ {label}を追加</button>
    </div>
  )
}

type Scope = 'one' | 'future'

/**
 * 案件の新規作成・編集フォーム。
 * 定期案件は「1日1件の実体」をシリーズIDでまとめて生成するので、当日だけの担当変更も自由にできる。
 */
export function JobForm({ db, initial, isNew, title, defaultFreq, onSave, onDelete, onClose }: {
  db: DB
  initial: Partial<Job>
  isNew: boolean
  title?: string
  defaultFreq?: RecurFreq
  onSave: (fn: (db: DB) => DB) => void
  onDelete?: (fn: (db: DB) => DB) => void
  onClose: () => void
}) {
  const [job, setJob] = useState<Job>(() => emptyJob(initial))
  const [recur, setRecur] = useState<RecurFreq | ''>(defaultFreq ?? '')
  const [until, setUntil] = useState('')
  const [scope, setScope] = useState<Scope>('one')
  const set = <K extends keyof Job>(k: K, v: Job[K]) => setJob((j) => ({ ...j, [k]: v }))
  const original = db.jobs.find((j) => j.id === job.id)
  const inSeries = !isNew && !!job.seriesId

  const matchesScope = (j: Job) =>
    j.id === job.id || (scope === 'future' && !!job.seriesId && j.seriesId === job.seriesId && j.date >= (original?.date ?? job.date))

  const save = () => {
    const clean = { ...job, pickups: job.pickups.filter(Boolean), dropoffs: job.dropoffs.filter(Boolean) }
    if (!clean.pickups.length) clean.pickups = ['']
    if (!clean.dropoffs.length) clean.dropoffs = ['']
    if (isNew) {
      if (recur) {
        if (!until || until < clean.date) return alert('定期案件の終了日を開始日以降で指定してください')
        const sid = uid()
        const jobs = recurDates(clean.date, until, recur).map((d) => ({ ...clean, id: uid(), date: d, seriesId: sid }))
        onSave((db) => ({ ...db, jobs: [...db.jobs, ...jobs] }))
      } else onSave((db) => ({ ...db, jobs: [...db.jobs, clean] }))
    } else {
      // 日付はその案件のみ変更。その他の項目は範囲指定で反映
      const { id: _id, date: _date, seriesId: _sid, ...fields } = clean
      onSave((db) => ({
        ...db,
        jobs: db.jobs.map((j) => (j.id === clean.id ? clean : matchesScope(j) ? { ...j, ...fields } : j)),
      }))
    }
    onClose()
  }

  return (
    <Modal title={title ?? (isNew ? '案件登録' : '案件編集')} onClose={onClose}>
      <div className="form">
        <div className="grid2">
          <label className="field"><span>日付{isNew && recur ? '（開始日）' : ''}</span>
            <input type="date" value={job.date} onChange={(e) => set('date', e.target.value)} />
          </label>
          <label className="field"><span>担当者</span>
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
          <StopList label="積み地" values={job.pickups} onChange={(v) => set('pickups', v)} />
          <StopList label="降ろし地" values={job.dropoffs} onChange={(v) => set('dropoffs', v)} />
        </div>
        <div className="grid3">
          <label className="field"><span>台数</span>
            <input type="number" min={1} value={job.vehicles} onChange={(e) => set('vehicles', Math.max(1, +e.target.value))} />
          </label>
          <label className="field"><span>請求額(円)</span>
            <input type="number" min={0} value={job.billAmount} onChange={(e) => set('billAmount', +e.target.value)} />
          </label>
          <label className="field"><span>支払額(円)</span>
            <input type="number" min={0} value={job.payAmount} onChange={(e) => set('payAmount', +e.target.value)} />
          </label>
        </div>

        {isNew && (
          <div className="grid2 boxed">
            <label className="field"><span>定期案件</span>
              <select value={recur} onChange={(e) => setRecur(e.target.value as RecurFreq | '')}>
                <option value="">単発</option>
                <option value="daily">毎日</option>
                <option value="weekdays">平日（月〜金）</option>
                <option value="weekly">毎週（開始日と同じ曜日）</option>
              </select>
            </label>
            {recur && (
              <label className="field"><span>終了日</span>
                <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
              </label>
            )}
          </div>
        )}

        <label className="field"><span>備考</span>
          <textarea rows={2} value={job.note} onChange={(e) => set('note', e.target.value)} />
        </label>

        {inSeries && (
          <div className="boxed">
            <span className="small">この案件は定期案件です。変更の反映範囲：</span>
            <label className="inline"><input type="radio" checked={scope === 'one'} onChange={() => setScope('one')} />この日のみ</label>
            <label className="inline"><input type="radio" checked={scope === 'future'} onChange={() => setScope('future')} />この日以降すべて</label>
          </div>
        )}

        <div className="actions">
          {!isNew && onDelete && (
            <button
              className="danger-btn"
              onClick={() => {
                if (!confirm(scope === 'future' ? 'この日以降の同じ定期案件をすべて削除しますか？' : 'この案件を削除しますか？')) return
                onDelete((db) => ({ ...db, jobs: db.jobs.filter((j) => !matchesScope(j)) }))
                onClose()
              }}
            >
              削除
            </button>
          )}
          <span className="spacer" />
          <button className="ghost" onClick={onClose}>キャンセル</button>
          <button onClick={save}>保存</button>
        </div>
      </div>
    </Modal>
  )
}
