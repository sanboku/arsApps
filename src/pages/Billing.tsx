import { useState } from 'react'
import * as XLSX from 'xlsx'
import type { Store } from '../store'
import { routeText, today, yen } from '../store'
import type { DB, Job } from '../types'

/** 支払先：所属会社のドライバーは会社単位でまとめる */
const payeeOf = (db: DB, j: Job) => {
  const d = db.drivers.find((x) => x.id === j.driverId)
  if (!d) return '（担当未定）'
  if (d.companyId) return db.companies.find((c) => c.id === d.companyId)?.name ?? d.fullName
  return d.fullName
}

function summarize(jobs: Job[], keyOf: (j: Job) => string) {
  const m = new Map<string, { count: number; bill: number; pay: number }>()
  for (const j of jobs) {
    const k = keyOf(j)
    const v = m.get(k) ?? { count: 0, bill: 0, pay: 0 }
    v.count++
    v.bill += j.billAmount
    v.pay += j.payAmount
    m.set(k, v)
  }
  return [...m.entries()].map(([name, v]) => ({ name, ...v }))
}

export default function Billing({ store }: { store: Store }) {
  const { db, update } = store
  const [month, setMonth] = useState(today().slice(0, 7))
  const [tab, setTab] = useState<'client' | 'payee' | 'detail'>('client')

  const jobs = db.jobs.filter((j) => j.date.startsWith(month)).sort((a, b) => a.date.localeCompare(b.date))
  const clientName = (j: Job) => db.clients.find((c) => c.id === j.clientId)?.name ?? '（請求先未設定）'
  const byClient = summarize(jobs, clientName)
  const byPayee = summarize(jobs, (j) => payeeOf(db, j))
  const total = { bill: jobs.reduce((s, j) => s + j.billAmount, 0), pay: jobs.reduce((s, j) => s + j.payAmount, 0) }

  const setAmount = (id: string, k: 'billAmount' | 'payAmount', v: number) =>
    update((db) => ({ ...db, jobs: db.jobs.map((j) => (j.id === id ? { ...j, [k]: v } : j)) }))

  const exportXlsx = () => {
    const wb = XLSX.utils.book_new()
    const detail = jobs.map((j) => ({
      日付: j.date,
      請求先: clientName(j),
      担当: db.drivers.find((d) => d.id === j.driverId)?.fullName ?? '未定',
      支払先: payeeOf(db, j),
      時間: [j.pickupTime, j.dropoffTime].filter(Boolean).join('〜'),
      積み地: j.pickups.filter(Boolean).join(' / '),
      降ろし地: j.dropoffs.filter(Boolean).join(' / '),
      請求額: j.billAmount,
      支払額: j.payAmount,
      粗利: j.billAmount - j.payAmount,
      備考: j.note,
    }))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detail), '明細')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(byClient.map((r) => ({ 請求先: r.name, 件数: r.count, 請求額: r.bill }))), '請求先別')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(byPayee.map((r) => ({ 支払先: r.name, 件数: r.count, 支払額: r.pay }))), '支払先別')
    // 請求先ごとのシート（請求書の下書きとして編集できるように）
    for (const c of byClient) {
      const rows = jobs.filter((j) => clientName(j) === c.name).map((j) => ({ 日付: j.date, 内容: routeText(j), 金額: j.billAmount }))
      rows.push({ 日付: '', 内容: '合計', 金額: c.bill })
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), c.name.replace(/[\\/?*[\]:]/g, '').slice(0, 31))
    }
    XLSX.writeFile(wb, `請求支払_${month}.xlsx`)
  }

  return (
    <div className="page">
      <div className="toolbar">
        <h2>請求・支払管理</h2>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        <button onClick={exportXlsx}>Excel出力</button>
        <button className="secondary" onClick={() => window.print()}>印刷 / PDF</button>
      </div>
      <div className="stats">
        <div className="stat"><span>案件数</span><b>{jobs.length}件</b></div>
        <div className="stat"><span>請求合計</span><b>{yen(total.bill)}</b></div>
        <div className="stat"><span>支払合計</span><b>{yen(total.pay)}</b></div>
        <div className="stat"><span>粗利</span><b>{yen(total.bill - total.pay)}</b></div>
      </div>
      <div className="tabs no-print">
        <button className={tab === 'client' ? 'active' : ''} onClick={() => setTab('client')}>請求先別</button>
        <button className={tab === 'payee' ? 'active' : ''} onClick={() => setTab('payee')}>支払先別</button>
        <button className={tab === 'detail' ? 'active' : ''} onClick={() => setTab('detail')}>明細（金額編集）</button>
      </div>
      <div className="card scroll-x">
        {tab === 'detail' ? (
          <table>
            <thead><tr><th>日付</th><th>請求先</th><th>支払先</th><th>内容</th><th>請求額</th><th>支払額</th></tr></thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td className="nowrap">{j.date}</td>
                  <td>{clientName(j)}</td>
                  <td>{payeeOf(db, j)}</td>
                  <td className="small">{routeText(j)}{j.groupId && '（複数台）'}</td>
                  <td><input className="num" type="number" value={j.billAmount} onChange={(e) => setAmount(j.id, 'billAmount', +e.target.value)} /></td>
                  <td><input className="num" type="number" value={j.payAmount} onChange={(e) => setAmount(j.id, 'payAmount', +e.target.value)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table>
            <thead><tr><th>{tab === 'client' ? '請求先' : '支払先'}</th><th>件数</th><th>{tab === 'client' ? '請求額' : '支払額'}</th></tr></thead>
            <tbody>
              {(tab === 'client' ? byClient : byPayee).map((r) => (
                <tr key={r.name}><td>{r.name}</td><td>{r.count}</td><td className="right">{yen(tab === 'client' ? r.bill : r.pay)}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
