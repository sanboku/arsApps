import { useState } from 'react'
import type { Store } from '../store'
import { today, uid } from '../store'
import type { Driver, DriverKind } from '../types'
import { JobForm, Modal } from '../components'

const KIND_LABEL: Record<DriverKind, string> = { individual: '個人委託', company: '所属会社', employee: '自社正社員' }

export default function Drivers({ store }: { store: Store }) {
  const { db, update } = store
  const [edit, setEdit] = useState<Driver | null>(null)
  const [jobFor, setJobFor] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const list = db.drivers.filter((d) => !q || `${d.fullName}${d.kana}${d.displayName}${d.phone}`.includes(q))

  return (
    <div className="page">
      <div className="toolbar">
        <h2>ドライバー管理</h2>
        <input placeholder="検索（氏名・かな・電話）" value={q} onChange={(e) => setQ(e.target.value)} />
        <button onClick={() => setEdit({ id: uid(), fullName: '', kana: '', phone: '', displayName: '', kind: 'individual', showOnCalendar: true })}>＋ ドライバー登録</button>
      </div>
      <div className="card scroll-x">
        <table>
          <thead>
            <tr><th>表示名</th><th>氏名 / かな</th><th>電話番号</th><th>区分</th><th>予定表に常時表示</th><th></th></tr>
          </thead>
          <tbody>
            {list.map((d) => (
              <tr key={d.id}>
                <td><b>{d.displayName}</b></td>
                <td>{d.fullName}<div className="muted small">{d.kana}</div></td>
                <td><a href={`tel:${d.phone}`}>{d.phone}</a></td>
                <td>{KIND_LABEL[d.kind]}{d.companyId && <div className="muted small">{db.companies.find((c) => c.id === d.companyId)?.name}</div>}</td>
                <td>{d.showOnCalendar ? '○' : <span className="muted">非表示</span>}</td>
                <td className="nowrap">
                  <button className="ghost small" onClick={() => setJobFor(d.id)}>案件作成</button>
                  <button className="ghost small" onClick={() => setEdit(d)}>編集</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <CompanyEditor store={store} />

      {edit && <DriverForm store={store} initial={edit} onClose={() => setEdit(null)} />}
      {jobFor && <JobForm db={db} initial={{ driverId: jobFor, date: today() }} isNew onSave={update} onClose={() => setJobFor(null)} />}
    </div>
  )
}

function DriverForm({ store, initial, onClose }: { store: Store; initial: Driver; onClose: () => void }) {
  const { db, update } = store
  const [d, setD] = useState(initial)
  const set = <K extends keyof Driver>(k: K, v: Driver[K]) => setD((x) => ({ ...x, [k]: v }))
  const exists = db.drivers.some((x) => x.id === d.id)
  return (
    <Modal title={exists ? 'ドライバー編集' : 'ドライバー登録'} onClose={onClose}>
      <div className="form">
        <div className="grid2">
          <label className="field"><span>フルネーム *</span><input value={d.fullName} onChange={(e) => set('fullName', e.target.value)} /></label>
          <label className="field"><span>読み仮名</span><input value={d.kana} onChange={(e) => set('kana', e.target.value)} /></label>
          <label className="field"><span>電話番号</span><input type="tel" value={d.phone} onChange={(e) => set('phone', e.target.value)} /></label>
          <label className="field"><span>表示名（予定表に表示） *</span><input value={d.displayName} onChange={(e) => set('displayName', e.target.value)} /></label>
          <label className="field"><span>区分</span>
            <select value={d.kind} onChange={(e) => set('kind', e.target.value as DriverKind)}>
              {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          {d.kind === 'company' && (
            <label className="field"><span>所属会社</span>
              <select value={d.companyId ?? ''} onChange={(e) => set('companyId', e.target.value || undefined)}>
                <option value="">選択してください</option>
                {db.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          )}
        </div>
        <label className="inline"><input type="checkbox" checked={d.showOnCalendar} onChange={(e) => set('showOnCalendar', e.target.checked)} />予定表に常に表示する（オフでも案件がある週は表示）</label>
        <div className="actions">
          {exists && (
            <button className="danger-btn" onClick={() => {
              if (!confirm('削除しますか？担当案件は「担当者未定」になります')) return
              update((db) => ({ ...db, drivers: db.drivers.filter((x) => x.id !== d.id), jobs: db.jobs.map((j) => (j.driverId === d.id ? { ...j, driverId: null } : j)) }))
              onClose()
            }}>削除</button>
          )}
          <span className="spacer" />
          <button className="ghost" onClick={onClose}>キャンセル</button>
          <button onClick={() => {
            if (!d.fullName || !d.displayName) return alert('フルネームと表示名は必須です')
            if (d.kind === 'company' && !d.companyId) return alert('所属会社を選択してください')
            const clean = d.kind === 'company' ? d : { ...d, companyId: undefined }
            update((db) => ({ ...db, drivers: exists ? db.drivers.map((x) => (x.id === d.id ? clean : x)) : [...db.drivers, clean] }))
            onClose()
          }}>保存</button>
        </div>
      </div>
    </Modal>
  )
}

function CompanyEditor({ store }: { store: Store }) {
  const { db, update } = store
  const [name, setName] = useState('')
  return (
    <section className="card">
      <h3>委託会社</h3>
      <ul className="list">
        {db.companies.map((c) => (
          <li key={c.id}>{c.name} <span className="muted small">（{db.drivers.filter((d) => d.companyId === c.id).length}名）</span></li>
        ))}
      </ul>
      <div className="row">
        <input placeholder="会社名" value={name} onChange={(e) => setName(e.target.value)} />
        <button onClick={() => { if (!name) return; update((db) => ({ ...db, companies: [...db.companies, { id: uid(), name }] })); setName('') }}>追加</button>
      </div>
    </section>
  )
}
