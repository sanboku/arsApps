import type { Store } from '../store'
import { addDays, daysUntil, fmtMD, today, weekStart } from '../store'

const TILES = [
  { href: '#schedule', icon: '📅', title: '案件予定表', desc: 'ドライバー×日付で案件を管理' },
  { href: '#drivers', icon: '👤', title: 'ドライバー管理', desc: '登録・連絡先・表示設定' },
  { href: '#clients', icon: '🏢', title: '請求先管理', desc: '請求先とカード色の設定' },
  { href: '#billing', icon: '💴', title: '請求・支払管理', desc: '月次集計・Excel出力' },
  { href: '#vehicles', icon: '🚚', title: '車両管理', desc: '車検・修理・貸出' },
]

export default function Home({ store }: { store: Store }) {
  const { db } = store
  const t = today()
  const ws = weekStart(t)
  const we = addDays(ws, 6)
  const todayJobs = db.jobs.filter((j) => j.date === t)
  const unassigned = db.jobs.filter((j) => !j.driverId && j.date >= t && j.date <= we)
  const inspections = [...db.vehicles]
    .sort((a, b) => a.inspectionDate.localeCompare(b.inspectionDate))
    .filter((v) => daysUntil(v.inspectionDate) <= 60)

  return (
    <div className="page">
      <h2>トップ</h2>
      <div className="stats">
        <div className="stat"><span>本日の案件</span><b>{todayJobs.length}件</b></div>
        <div className={`stat ${unassigned.length ? 'warn' : ''}`}><span>今週の担当未定</span><b>{unassigned.length}件</b></div>
        <div className={`stat ${inspections.length ? 'warn' : ''}`}><span>60日以内の車検</span><b>{inspections.length}台</b></div>
      </div>

      <div className="tiles">
        {TILES.map((x) => (
          <a key={x.href} href={x.href} className="tile">
            <span className="icon">{x.icon}</span>
            <b>{x.title}</b>
            <span className="muted small">{x.desc}</span>
          </a>
        ))}
      </div>

      <div className="grid2">
        <section className="card">
          <h3>車両ダッシュボード</h3>
          <table>
            <thead><tr><th>車両</th><th>車検満了</th><th>貸出先</th><th>最終使用</th></tr></thead>
            <tbody>
              {db.vehicles.map((v) => {
                const left = daysUntil(v.inspectionDate)
                return (
                  <tr key={v.id}>
                    <td>{v.name}<div className="muted small">{v.plate}</div></td>
                    <td className={left <= 30 ? 'danger' : left <= 60 ? 'warn-text' : ''}>
                      {v.inspectionDate}<div className="small">あと{left}日</div>
                    </td>
                    <td>{v.lentTo || '—'}</td>
                    <td>{v.lastUsed || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>
        <section className="card">
          <h3>今週の担当未定案件</h3>
          {unassigned.length === 0 ? (
            <p className="muted">なし</p>
          ) : (
            <ul className="list">
              {unassigned.map((j) => (
                <li key={j.id}>
                  {fmtMD(j.date)} {db.clients.find((c) => c.id === j.clientId)?.name ?? '請求先未設定'}：
                  {j.pickups.filter(Boolean).join('・')} → {j.dropoffs.filter(Boolean).join('・')}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
