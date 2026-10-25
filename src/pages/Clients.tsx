import { useState } from 'react'
import type { Store } from '../store'
import { uid } from '../store'

const PALETTE = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#64748b']

export default function Clients({ store }: { store: Store }) {
  const { db, update } = store
  const [name, setName] = useState('')
  const [color, setColor] = useState(PALETTE[db.clients.length % PALETTE.length])

  return (
    <div className="page">
      <h2>請求先管理</h2>
      <p className="muted small">ここで設定した色が予定表の案件カードに自動で反映されます。</p>
      <div className="card">
        <table>
          <thead><tr><th>色</th><th>請求先名</th><th>案件数</th><th></th></tr></thead>
          <tbody>
            {db.clients.map((c) => (
              <tr key={c.id}>
                <td><input type="color" value={c.color} onChange={(e) => update((db) => ({ ...db, clients: db.clients.map((x) => (x.id === c.id ? { ...x, color: e.target.value } : x)) }))} /></td>
                <td><input value={c.name} onChange={(e) => update((db) => ({ ...db, clients: db.clients.map((x) => (x.id === c.id ? { ...x, name: e.target.value } : x)) }))} /></td>
                <td>{db.jobs.filter((j) => j.clientId === c.id).length}</td>
                <td>
                  <button className="ghost small" onClick={() => {
                    if (!confirm(`${c.name} を削除しますか？`)) return
                    update((db) => ({ ...db, clients: db.clients.filter((x) => x.id !== c.id), jobs: db.jobs.map((j) => (j.clientId === c.id ? { ...j, clientId: null } : j)) }))
                  }}>削除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row">
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
          <input placeholder="請求先名" value={name} onChange={(e) => setName(e.target.value)} />
          <button onClick={() => {
            if (!name) return
            update((db) => ({ ...db, clients: [...db.clients, { id: uid(), name, color }] }))
            setName('')
            setColor(PALETTE[(db.clients.length + 1) % PALETTE.length])
          }}>追加</button>
        </div>
      </div>
    </div>
  )
}
