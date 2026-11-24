import { useState } from 'react'
import * as XLSX from 'xlsx'
import type { Payee, Store } from '../store'
import { fmtMD, isClosed, payeeOf, profitRate, routeText, today, uid, yen } from '../store'
import type { BillingDoc, Job, Rate, Settings } from '../types'
import { JobForm, Modal } from '../components'
import DocEditor, { buildDoc } from './DocEditor'

type Tab = 'ledger' | 'client' | 'payee' | 'docs' | 'rates' | 'settings'
const TABS: [Tab, string][] = [
  ['ledger', '管理表'],
  ['client', '請求先別'],
  ['payee', '支払先別'],
  ['docs', '帳票（請求書・支払明細）'],
  ['rates', '単価マスタ'],
  ['settings', '自社情報'],
]

const rateText = (bill: number, pay: number) => {
  const r = profitRate(bill, pay)
  return r === null ? '—' : `${r}%`
}

/** 請求先・支払先ごとの集計 */
function summarize(jobs: Job[], keyOf: (j: Job) => { key: string; label: string; official?: string } | null) {
  const m = new Map<string, { key: string; label: string; official?: string; count: number; bill: number; pay: number; distance: number }>()
  for (const j of jobs) {
    const k = keyOf(j)
    if (!k) continue
    const v = m.get(k.key) ?? { ...k, count: 0, bill: 0, pay: 0, distance: 0 }
    v.count++
    v.bill += j.billAmount
    v.pay += j.payAmount
    v.distance += j.distance ?? 0
    m.set(k.key, v)
  }
  return [...m.values()]
}

export default function Billing({ store }: { store: Store }) {
  const { db, update } = store
  const [month, setMonth] = useState(today().slice(0, 7))
  const [tab, setTab] = useState<Tab>('ledger')
  const [clientFilter, setClientFilter] = useState('')
  const [payeeFilter, setPayeeFilter] = useState('')
  const [editJob, setEditJob] = useState<Job | null>(null)
  const [openDoc, setOpenDoc] = useState<string | null>(null)

  const closed = isClosed(db, `${month}-01`)
  const monthJobs = db.jobs.filter((j) => j.date.startsWith(month)).sort((a, b) => a.date.localeCompare(b.date) || (a.pickupTime || a.dropoffTime).localeCompare(b.pickupTime || b.dropoffTime))
  const client = (j: Job) => db.clients.find((c) => c.id === j.clientId)
  const driver = (j: Job) => db.drivers.find((d) => d.id === j.driverId)
  const payee = (j: Job) => payeeOf(db, j.driverId)
  const jobs = monthJobs.filter((j) => (!clientFilter || (j.clientId ?? 'none') === clientFilter) && (!payeeFilter || (payee(j)?.key ?? 'none') === payeeFilter))
  const total = {
    bill: jobs.reduce((s, j) => s + j.billAmount, 0),
    pay: jobs.reduce((s, j) => s + j.payAmount, 0),
    distance: jobs.reduce((s, j) => s + (j.distance ?? 0), 0),
  }
  const unassigned = monthJobs.filter((j) => !j.driverId).length
  const noAmount = monthJobs.filter((j) => !j.billAmount).length
  const noClient = monthJobs.filter((j) => !j.clientId).length

  const byClient = summarize(monthJobs, (j) => (client(j) ? { key: `client:${j.clientId}`, label: client(j)!.name, official: client(j)!.officialName } : { key: 'client:none', label: '（請求先未設定）' }))
  const byPayee = summarize(monthJobs, (j) => {
    const p = payee(j)
    return p ? { key: p.key, label: p.kind === 'driver' ? `${p.short}（個人）` : p.short, official: p.officialName } : { key: 'none', label: '（担当者未定）' }
  })
  const payees = [...new Map(db.drivers.map((d) => payeeOf(db, d.id)).filter((p): p is Payee => !!p).map((p) => [p.key, p])).values()]

  const setJob = (id: string, patch: Partial<Job>) => update((db) => ({ ...db, jobs: db.jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)) }))

  const close = () => {
    const warn = [unassigned && `担当者未定：${unassigned}件`, noClient && `請求先未設定：${noClient}件`, noAmount && `請求額が0円：${noAmount}件`].filter(Boolean)
    const msg = `${month.replace('-', '年')}月を締めますか？\n締めると、この月の案件・金額は変更できなくなり、帳票（請求書・支払明細）を作成できるようになります。${warn.length ? `\n\n【確認】\n${warn.join('\n')}` : ''}`
    if (!confirm(msg)) return
    update((db) => ({ ...db, closedMonths: [...db.closedMonths, month] }))
    setTab('docs')
  }
  const reopen = () => {
    if (!confirm('締めを解除しますか？\n案件・金額が再び変更できるようになります。作成済みの帳票はそのまま残ります（必要なら「作り直す」で更新してください）。')) return
    update((db) => ({ ...db, closedMonths: db.closedMonths.filter((m) => m !== month) }))
  }

  const exportLedger = () => {
    const rows = jobs.map((j) => ({
      日付: j.date,
      担当者: driver(j)?.displayName ?? '未定',
      所属: payee(j)?.kind === 'driver' ? '個人' : payee(j)?.short ?? '',
      内容: routeText(j),
      距離km: j.distance ?? '',
      請求先: client(j)?.name ?? '',
      請求額: j.billAmount,
      支払額: j.payAmount,
      利益率: rateText(j.billAmount, j.payAmount),
      備考: j.note,
    }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), '管理表')
    XLSX.writeFile(wb, `管理表_${month}.xlsx`)
  }

  return (
    <div className="page wide billing">
      <div className="toolbar">
        <h2>請求・支払管理</h2>
        <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
        {closed ? (
          <>
            <span className="badge-closed">🔒 締め済み</span>
            <button className="ghost" onClick={reopen}>締め解除</button>
          </>
        ) : (
          <button onClick={close}>この月を締める</button>
        )}
      </div>
      <div className="stats">
        <div className="stat"><span>案件数</span><b>{monthJobs.length}件</b></div>
        <div className="stat"><span>請求合計（税抜）</span><b>{yen(monthJobs.reduce((s, j) => s + j.billAmount, 0))}</b></div>
        <div className="stat"><span>支払合計（税抜）</span><b>{yen(monthJobs.reduce((s, j) => s + j.payAmount, 0))}</b></div>
        <div className="stat"><span>利益率</span><b>{rateText(monthJobs.reduce((s, j) => s + j.billAmount, 0), monthJobs.reduce((s, j) => s + j.payAmount, 0))}</b></div>
      </div>
      <div className="tabs">
        {TABS.map(([k, label]) => <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{label}</button>)}
      </div>

      {tab === 'ledger' && (
        <div className="card">
          <div className="row wrap ledger-tools">
            <select value={clientFilter} onChange={(e) => setClientFilter(e.target.value)}>
              <option value="">請求先：すべて</option>
              {db.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              <option value="none">（請求先未設定）</option>
            </select>
            <select value={payeeFilter} onChange={(e) => setPayeeFilter(e.target.value)}>
              <option value="">所属（支払先）：すべて</option>
              {payees.map((p) => <option key={p.key} value={p.key}>{p.kind === 'driver' ? `${p.short}（個人）` : p.short}</option>)}
              <option value="none">（担当者未定）</option>
            </select>
            <span className="spacer" />
            <button className="secondary" onClick={exportLedger}>Excel出力</button>
          </div>
          {(unassigned > 0 || noClient > 0 || noAmount > 0) && (
            <p className="small warn-text">
              確認：{[unassigned && `担当者未定 ${unassigned}件`, noClient && `請求先未設定 ${noClient}件`, noAmount && `請求額0円 ${noAmount}件`].filter(Boolean).join('・')}（黄色の行）
            </p>
          )}
          <p className="small muted">
            予定表の案件カードと連動しています。カードを追加するとこの表に行が増え、ここで金額・距離を直すとカードにも反映されます。内容をクリックするとカードの編集画面が開きます。
            {closed && ' この月は締め済みのため変更できません。'}
          </p>
          <div className="scroll-x">
            <table className="ledger">
              <thead>
                <tr>
                  <th>日付</th><th>担当者</th><th>所属</th><th>内容</th><th className="right">距離(km)</th><th>請求先</th>
                  <th className="right">請求額</th><th className="right">支払額</th><th className="right">利益率</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => {
                  const p = payee(j)
                  const warn = !j.driverId || !j.clientId || !j.billAmount
                  return (
                    <tr key={j.id} className={warn ? 'warn-row' : ''}>
                      <td className="nowrap">{fmtMD(j.date)}</td>
                      <td className="nowrap">{driver(j)?.displayName ?? <b className="danger">未定</b>}</td>
                      <td className="nowrap">{p ? (p.kind === 'driver' ? <span className="muted">個人</span> : p.short) : '—'}</td>
                      <td><button className="link" onClick={() => setEditJob(j)}>{routeText(j)}</button>{j.groupId && <span className="small muted">（複数台）</span>}</td>
                      <td className="right"><input className="num short" type="number" min={0} disabled={closed} value={j.distance ?? ''} onChange={(e) => setJob(j.id, { distance: e.target.value === '' ? undefined : +e.target.value })} /></td>
                      <td className="nowrap"><i className="dot" style={{ background: client(j)?.color }} />{client(j)?.name ?? <span className="danger">未設定</span>}</td>
                      <td className="right"><input className="num" type="number" min={0} disabled={closed} value={j.billAmount} onChange={(e) => setJob(j.id, { billAmount: +e.target.value })} /></td>
                      <td className="right"><input className="num" type="number" min={0} disabled={closed} value={j.payAmount} onChange={(e) => setJob(j.id, { payAmount: +e.target.value })} /></td>
                      <td className="right nowrap">{rateText(j.billAmount, j.payAmount)}</td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr>
                  <th colSpan={4}>合計（{jobs.length}件）</th>
                  <th className="right">{total.distance.toLocaleString()}</th>
                  <th></th>
                  <th className="right">{yen(total.bill)}</th>
                  <th className="right">{yen(total.pay)}</th>
                  <th className="right">{rateText(total.bill, total.pay)}</th>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {(tab === 'client' || tab === 'payee') && (
        <div className="card scroll-x">
          <table>
            <thead><tr><th>{tab === 'client' ? '請求先' : '支払先'}</th><th>正式名称</th><th className="right">件数</th><th className="right">距離(km)</th><th className="right">{tab === 'client' ? '請求額' : '支払額'}</th>{tab === 'client' && <th className="right">利益率</th>}</tr></thead>
            <tbody>
              {(tab === 'client' ? byClient : byPayee).map((r) => (
                <tr key={r.key}>
                  <td>{r.label}</td>
                  <td className="muted">{r.official ?? ''}</td>
                  <td className="right">{r.count}</td>
                  <td className="right">{r.distance.toLocaleString()}</td>
                  <td className="right">{yen(tab === 'client' ? r.bill : r.pay)}</td>
                  {tab === 'client' && <td className="right">{rateText(r.bill, r.pay)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
          {tab === 'payee' && <p className="small muted">「自社」は自社正社員の案件です（支払明細は作成しません）。</p>}
        </div>
      )}

      {tab === 'docs' && <DocsTab store={store} month={month} closed={closed} onClose={close} onOpen={setOpenDoc} byClient={byClient} byPayee={byPayee} />}
      {tab === 'rates' && <RatesTab store={store} payees={payees} />}
      {tab === 'settings' && <SettingsTab store={store} />}

      {editJob && <JobForm db={db} initial={editJob} isNew={false} onSave={update} onDelete={update} onClose={() => setEditJob(null)} />}
      {openDoc && db.docs.find((d) => d.id === openDoc) && (
        <DocEditor
          doc={db.docs.find((d) => d.id === openDoc)!}
          settings={db.settings}
          onChange={(doc) => update((db) => ({ ...db, docs: db.docs.map((d) => (d.id === doc.id ? doc : d)) }))}
          onRegenerate={() => update((db) => ({ ...db, docs: db.docs.map((d) => (d.id === openDoc ? { ...buildDoc(db, d.month, d.kind, d.partyKey, d.number), id: d.id } : d)) }))}
          onClose={() => setOpenDoc(null)}
        />
      )}
    </div>
  )
}

/** 帳票タブ：締め後に、請求先ごとの請求書・支払先ごとの支払明細書を作成・編集・PDF出力 */
function DocsTab({ store, month, closed, onClose, onOpen, byClient, byPayee }: {
  store: Store
  month: string
  closed: boolean
  onClose: () => void
  onOpen: (id: string) => void
  byClient: ReturnType<typeof summarize>
  byPayee: ReturnType<typeof summarize>
}) {
  const { db, update } = store
  if (!closed)
    return (
      <div className="card">
        <p>帳票は、月を締めてから作成します。金額などを確認したら「この月を締める」を押してください。</p>
        <button onClick={onClose}>この月を締める</button>
      </div>
    )
  const docOf = (kind: BillingDoc['kind'], key: string) => db.docs.find((d) => d.month === month && d.kind === kind && d.partyKey === key)
  /** 帳票を開く（なければ管理表から作成） */
  const open = (kind: BillingDoc['kind'], key: string) => {
    const existing = docOf(kind, key)
    if (existing) return onOpen(existing.id)
    const seq = db.docs.filter((d) => d.month === month && d.kind === kind).length + 1
    const doc = buildDoc(db, month, kind, key, `${month.replace('-', '')}-${kind === 'invoice' ? 'S' : 'P'}${String(seq).padStart(3, '0')}`)
    update((db) => ({ ...db, docs: [...db.docs, doc] }))
    onOpen(doc.id)
  }
  const section = (kind: BillingDoc['kind'], rows: ReturnType<typeof summarize>) => (
    <table>
      <thead><tr><th>宛先（略称）</th><th>正式名称</th><th className="right">件数</th><th className="right">金額（税抜）</th><th>状態</th><th></th></tr></thead>
      <tbody>
        {rows.map((r) => {
          const ok = !r.key.endsWith(':none') && r.key !== 'none' && r.key !== 'self'
          const doc = docOf(kind, r.key)
          return (
            <tr key={r.key}>
              <td>{r.label}</td>
              <td className="muted">{r.official ?? ''}</td>
              <td className="right">{r.count}</td>
              <td className="right">{yen(kind === 'invoice' ? r.bill : r.pay)}</td>
              <td>{!ok ? <span className="muted">対象外</span> : !doc ? <span className="muted">未作成</span> : doc.edited ? '編集済み' : '作成済み'}</td>
              <td className="nowrap">{ok && <button className="small" onClick={() => open(kind, r.key)}>{doc ? '開く' : '作成して開く'}</button>}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
  return (
    <>
      <div className="card">
        <h3>請求書（請求先ごと）</h3>
        {section('invoice', byClient)}
      </div>
      <div className="card">
        <h3>支払明細書（支払先ごと）</h3>
        {section('payment', byPayee)}
        <p className="small muted">自社正社員・担当者未定の案件は支払明細の対象外です。</p>
      </div>
    </>
  )
}

/** 単価マスタ：シーズン案件などの請求額と、支払先ごとの支払額 */
function RatesTab({ store, payees }: { store: Store; payees: Payee[] }) {
  const { db } = store
  const [edit, setEdit] = useState<Rate | null>(null)
  const payeeLabel = (key: string) => {
    const p = payees.find((x) => x.key === key)
    return p ? (p.kind === 'driver' ? `${p.short}（個人）` : p.short) : key
  }
  return (
    <div className="card">
      <div className="row">
        <p className="small muted spacer">案件登録で単価を選ぶと、請求額・支払額（担当者の支払先に応じた額）・距離が自動で入ります。</p>
        <button onClick={() => setEdit({ id: uid(), name: '', clientId: null, from: '', to: '', billAmount: 0, payDefault: 0, payByPayee: {}, note: '' })}>＋ 単価を追加</button>
      </div>
      <div className="scroll-x">
        <table>
          <thead><tr><th>名称</th><th>請求先</th><th>適用期間</th><th className="right">請求額</th><th className="right">支払額（標準）</th><th>支払先ごとの支払額</th><th className="right">距離</th><th className="right">使用</th></tr></thead>
          <tbody>
            {db.rates.map((r) => (
              <tr key={r.id} className="clickable" onClick={() => setEdit(r)}>
                <td><b>{r.name}</b>{r.note && <div className="small muted">{r.note}</div>}</td>
                <td>{db.clients.find((c) => c.id === r.clientId)?.name ?? '（指定なし）'}</td>
                <td className="nowrap">{r.from || r.to ? `${r.from || '…'} 〜 ${r.to || '…'}` : '通年'}</td>
                <td className="right">{yen(r.billAmount)}</td>
                <td className="right">{yen(r.payDefault)}</td>
                <td className="small">{Object.entries(r.payByPayee).map(([k, v]) => `${payeeLabel(k)} ${yen(v)}`).join('、') || '—'}</td>
                <td className="right">{r.distance ? `${r.distance}km` : '—'}</td>
                <td className="right">{db.jobs.filter((j) => j.rateId === r.id).length}件</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && <RateForm store={store} initial={edit} payees={payees} onClose={() => setEdit(null)} />}
    </div>
  )
}

function RateForm({ store, initial, payees, onClose }: { store: Store; initial: Rate; payees: Payee[]; onClose: () => void }) {
  const { db, update } = store
  const [r, setR] = useState(initial)
  const set = <K extends keyof Rate>(k: K, v: Rate[K]) => setR((x) => ({ ...x, [k]: v }))
  const exists = db.rates.some((x) => x.id === r.id)
  const options = payees.filter((p) => p.kind !== 'self' && !(p.key in r.payByPayee))
  return (
    <Modal title={exists ? '単価の編集' : '単価の追加'} onClose={onClose}>
      <div className="form">
        <div className="grid2">
          <label className="field"><span>名称 *</span><input value={r.name} onChange={(e) => set('name', e.target.value)} placeholder="例：年末増便（〇〇物流）" /></label>
          <label className="field"><span>請求先</span>
            <select value={r.clientId ?? ''} onChange={(e) => set('clientId', e.target.value || null)}>
              <option value="">（指定なし）</option>
              {db.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="field"><span>適用開始日（空欄＝制限なし）</span><input type="date" value={r.from} onChange={(e) => set('from', e.target.value)} /></label>
          <label className="field"><span>適用終了日（空欄＝制限なし）</span><input type="date" value={r.to} onChange={(e) => set('to', e.target.value)} /></label>
        </div>
        <div className="grid3">
          <label className="field"><span>請求額(円)</span><input type="number" min={0} value={r.billAmount} onChange={(e) => set('billAmount', +e.target.value)} /></label>
          <label className="field"><span>支払額・標準(円)</span><input type="number" min={0} value={r.payDefault} onChange={(e) => set('payDefault', +e.target.value)} /></label>
          <label className="field"><span>標準の距離(km)</span><input type="number" min={0} value={r.distance ?? ''} onChange={(e) => set('distance', e.target.value === '' ? undefined : +e.target.value)} /></label>
        </div>
        <div className="boxed">
          <span className="small"><b>支払先ごとの支払額</b>（ここにない支払先は「標準」の額。自社正社員は0円）</span>
          {Object.entries(r.payByPayee).map(([k, v]) => (
            <div className="row" key={k}>
              <span className="spacer">{payees.find((p) => p.key === k)?.short ?? k}</span>
              <input className="num" type="number" min={0} value={v} onChange={(e) => set('payByPayee', { ...r.payByPayee, [k]: +e.target.value })} />
              <button type="button" className="ghost" onClick={() => { const { [k]: _omit, ...rest } = r.payByPayee; set('payByPayee', rest) }}>−</button>
            </div>
          ))}
          {options.length > 0 && (
            <select value="" onChange={(e) => e.target.value && set('payByPayee', { ...r.payByPayee, [e.target.value]: r.payDefault })}>
              <option value="">＋ 支払先を追加…</option>
              {options.map((p) => <option key={p.key} value={p.key}>{p.kind === 'driver' ? `${p.short}（個人）` : p.short}</option>)}
            </select>
          )}
        </div>
        <label className="field"><span>メモ</span><input value={r.note} onChange={(e) => set('note', e.target.value)} /></label>
        <p className="small muted">単価を変更しても、すでに登録済みの案件の金額は変わりません（案件側で単価を選び直すと反映されます）。</p>
        <div className="actions">
          {exists && (
            <button className="danger-btn" onClick={() => {
              if (!confirm('この単価を削除しますか？（案件の金額はそのまま残ります）')) return
              update((db) => ({ ...db, rates: db.rates.filter((x) => x.id !== r.id), jobs: db.jobs.map((j) => (j.rateId === r.id ? { ...j, rateId: undefined } : j)) }))
              onClose()
            }}>削除</button>
          )}
          <span className="spacer" />
          <button className="ghost" onClick={onClose}>キャンセル</button>
          <button onClick={() => {
            if (!r.name) return alert('名称を入力してください')
            update((db) => ({ ...db, rates: exists ? db.rates.map((x) => (x.id === r.id ? r : x)) : [...db.rates, r] }))
            onClose()
          }}>保存</button>
        </div>
      </div>
    </Modal>
  )
}

/** 自社情報（帳票の発行元） */
function SettingsTab({ store }: { store: Store }) {
  const { db, update } = store
  const s = db.settings
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => update((db) => ({ ...db, settings: { ...db.settings, [k]: v } }))
  return (
    <div className="card form settings-form">
      <p className="small muted">請求書・支払明細書の発行元として印字されます。</p>
      <div className="grid2">
        <label className="field"><span>会社名</span><input value={s.companyName} onChange={(e) => set('companyName', e.target.value)} /></label>
        <label className="field"><span>電話番号</span><input value={s.tel} onChange={(e) => set('tel', e.target.value)} /></label>
        <label className="field"><span>郵便番号</span><input value={s.zip} onChange={(e) => set('zip', e.target.value)} /></label>
        <label className="field"><span>住所</span><input value={s.address} onChange={(e) => set('address', e.target.value)} /></label>
        <label className="field"><span>登録番号（インボイス）</span><input value={s.invoiceNo} onChange={(e) => set('invoiceNo', e.target.value)} placeholder="T から始まる13桁" /></label>
        <label className="field"><span>消費税率(%)</span><input type="number" min={0} value={s.taxRate} onChange={(e) => set('taxRate', +e.target.value)} /></label>
      </div>
      <label className="field"><span>振込先（請求書に印字）</span><input value={s.bank} onChange={(e) => set('bank', e.target.value)} /></label>
    </div>
  )
}
