import { useState } from 'react'
import type { Store } from '../store'
import { daysUntil, today, uid, yen } from '../store'
import type { Vehicle } from '../types'
import { Modal } from '../components'

export default function Vehicles({ store }: { store: Store }) {
  const { db } = store
  const [edit, setEdit] = useState<Vehicle | null>(null)
  const list = [...db.vehicles].sort((a, b) => a.inspectionDate.localeCompare(b.inspectionDate))
  return (
    <div className="page">
      <div className="toolbar">
        <h2>車両管理</h2>
        <button onClick={() => setEdit({ id: uid(), plate: '', name: '', inspectionDate: today(), lentTo: '', lastUsed: '', repairs: [] })}>＋ 車両登録</button>
      </div>
      <div className="vehicle-grid">
        {list.map((v) => {
          const left = daysUntil(v.inspectionDate)
          return (
            <div key={v.id} className={`card vehicle ${left <= 30 ? 'alert' : ''}`} onClick={() => setEdit(v)}>
              <b>{v.name}</b>
              <div className="muted small">{v.plate}</div>
              <dl>
                <dt>車検満了</dt><dd className={left <= 30 ? 'danger' : left <= 60 ? 'warn-text' : ''}>{v.inspectionDate}（あと{left}日）</dd>
                <dt>貸出先</dt><dd>{v.lentTo || '—'}</dd>
                <dt>最終使用</dt><dd>{v.lastUsed || '—'}</dd>
                <dt>修理履歴</dt><dd>{v.repairs.length}件</dd>
              </dl>
            </div>
          )
        })}
      </div>
      {edit && <VehicleForm store={store} initial={edit} onClose={() => setEdit(null)} />}
    </div>
  )
}

function VehicleForm({ store, initial, onClose }: { store: Store; initial: Vehicle; onClose: () => void }) {
  const { db, update } = store
  const [v, setV] = useState(initial)
  const set = <K extends keyof Vehicle>(k: K, val: Vehicle[K]) => setV((x) => ({ ...x, [k]: val }))
  const exists = db.vehicles.some((x) => x.id === v.id)
  return (
    <Modal title={exists ? '車両編集' : '車両登録'} onClose={onClose}>
      <div className="form">
        <div className="grid2">
          <label className="field"><span>車名</span><input value={v.name} onChange={(e) => set('name', e.target.value)} /></label>
          <label className="field"><span>ナンバー</span><input value={v.plate} onChange={(e) => set('plate', e.target.value)} /></label>
          <label className="field"><span>車検満了日</span><input type="date" value={v.inspectionDate} onChange={(e) => set('inspectionDate', e.target.value)} /></label>
          <label className="field"><span>貸出先</span>
            <input list="driver-names" value={v.lentTo} onChange={(e) => set('lentTo', e.target.value)} />
            <datalist id="driver-names">{db.drivers.map((d) => <option key={d.id} value={d.displayName} />)}</datalist>
          </label>
          <label className="field"><span>最終使用日</span>
            <div className="row"><input type="date" value={v.lastUsed} onChange={(e) => set('lastUsed', e.target.value)} /><button type="button" className="ghost small" onClick={() => set('lastUsed', today())}>今日</button></div>
          </label>
        </div>
        <div className="field">
          <span>修理履歴</span>
          {v.repairs.map((r, i) => (
            <div className="row" key={i}>
              <input type="date" value={r.date} onChange={(e) => set('repairs', v.repairs.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)))} />
              <input placeholder="内容" value={r.description} onChange={(e) => set('repairs', v.repairs.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
              <input className="num" type="number" placeholder="費用" value={r.cost} onChange={(e) => set('repairs', v.repairs.map((x, j) => (j === i ? { ...x, cost: +e.target.value } : x)))} />
              <button type="button" className="ghost" onClick={() => set('repairs', v.repairs.filter((_, j) => j !== i))}>−</button>
            </div>
          ))}
          <button type="button" className="link" onClick={() => set('repairs', [...v.repairs, { date: today(), description: '', cost: 0 }])}>＋ 修理履歴を追加</button>
          {v.repairs.length > 0 && <span className="small muted">修理費合計：{yen(v.repairs.reduce((s, r) => s + r.cost, 0))}</span>}
        </div>
        <div className="actions">
          {exists && <button className="danger-btn" onClick={() => { if (confirm('削除しますか？')) { update((db) => ({ ...db, vehicles: db.vehicles.filter((x) => x.id !== v.id) })); onClose() } }}>削除</button>}
          <span className="spacer" />
          <button className="ghost" onClick={onClose}>キャンセル</button>
          <button onClick={() => {
            if (!v.name) return alert('車名を入力してください')
            update((db) => ({ ...db, vehicles: exists ? db.vehicles.map((x) => (x.id === v.id ? v : x)) : [...db.vehicles, v] }))
            onClose()
          }}>保存</button>
        </div>
      </div>
    </Modal>
  )
}
