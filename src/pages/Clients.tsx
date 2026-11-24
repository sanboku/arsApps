import { useState } from 'react'
import type { Store } from '../store'
import { uid } from '../store'
import type { Client } from '../types'

const PALETTE = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#64748b']

export default function Clients({ store }: { store: Store }) {
  const { db, update } = store
  const [name, setName] = useState('')
  const [color, setColor] = useState(PALETTE[db.clients.length % PALETTE.length])
  const setClient = (id: string, patch: Partial<Client>) => update((db) => ({ ...db, clients: db.clients.map((x) => (x.id === id ? { ...x, ...patch } : x)) }))

  return (
    <div className="page">
      <h2>請求先管理</h2>
      <p className="muted small">
        ここで設定した色が予定表の案件カードに自動で反映されます。画面には「略称」を表示し、請求書には「正式名称・敬称・住所」を印字します。
      </p>
      <div className="card scroll-x">
        <table className="client-table">
          <thead><tr><th>色</th><th>略称（画面表示）</th><th>正式名称（請求書）</th><th>敬称</th><th>郵便番号</th><th>住所</th><th>案件数</th><th></th></tr></thead>
          <tbody>
            {db.clients.map((c) => (
              <tr key={c.id}>
                <td><input type="color" value={c.color} onChange={(e) => setClient(c.id, { color: e.target.value })} /></td>
                <td><input value={c.name} onChange={(e) => setClient(c.id, { name: e.target.value })} /></td>
                <td><input value={c.officialName ?? ''} placeholder={c.name} onChange={(e) => setClient(c.id, { officialName: e.target.value })} /></td>
                <td>
                  <select value={c.honorific ?? '御中'} onChange={(e) => setClient(c.id, { honorific: e.target.value })}>
                    <option>御中</option><option>様</option>
                  </select>
                </td>
                <td><input className="zip" value={c.zip ?? ''} onChange={(e) => setClient(c.id, { zip: e.target.value })} /></td>
                <td><input value={c.address ?? ''} onChange={(e) => setClient(c.id, { address: e.target.value })} /></td>
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
          <input placeholder="略称" value={name} onChange={(e) => setName(e.target.value)} />
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
