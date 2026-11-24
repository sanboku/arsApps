import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import * as XLSX from 'xlsx'
import { fmtMD, monthDays, payeeOf, routeText, uid, yen } from '../store'
import type { BillingDoc, DB, DocLine, Job, Settings } from '../types'

/** 帳票の対象となる案件（請求書は請求先ごと、支払明細書は支払先ごと） */
export function partyJobs(db: DB, month: string, kind: BillingDoc['kind'], partyKey: string) {
  return db.jobs
    .filter((j) => j.date.startsWith(month))
    .filter((j) => (kind === 'invoice' ? `client:${j.clientId}` === partyKey : payeeOf(db, j.driverId)?.key === partyKey))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.pickupTime || a.dropoffTime).localeCompare(b.pickupTime || b.dropoffTime))
}
/** 管理表上の合計（金額＋立替金） */
export const partyTotal = (db: DB, month: string, kind: BillingDoc['kind'], partyKey: string) =>
  partyJobs(db, month, kind, partyKey).reduce((s, j) => s + (kind === 'invoice' ? j.billAmount : j.payAmount) + (j.advance ?? 0), 0)

/**
 * 管理表（その月の案件）から帳票を作る。
 * 固定業務・定期案件（同じシリーズで金額が同じもの）は「期間・回数 × 単価」の1行にまとめる。
 */
export function buildDoc(db: DB, month: string, kind: BillingDoc['kind'], partyKey: string, number: string): BillingDoc {
  const jobs = partyJobs(db, month, kind, partyKey)
  let to = { name: '', honorific: '御中', zip: '', address: '' }
  if (kind === 'invoice') {
    const c = db.clients.find((x) => `client:${x.id}` === partyKey)
    if (c) to = { name: c.officialName || c.name, honorific: c.honorific || '御中', zip: c.zip ?? '', address: c.address ?? '' }
  } else {
    const p = jobs.length ? payeeOf(db, jobs[0].driverId) : null
    if (p) to = { name: p.officialName ?? p.short, honorific: p.honorific ?? '様', zip: p.zip ?? '', address: p.address ?? '' }
  }
  const amountOf = (j: Job) => (kind === 'invoice' ? j.billAmount : j.payAmount)
  // 会社あての支払明細は、どのドライバーの分か分かるように名前を付ける
  const whoOf = (j: Job) => (kind === 'payment' && partyKey.startsWith('company:') ? ` ／ ${db.drivers.find((d) => d.id === j.driverId)?.displayName ?? ''}` : '')

  const groups = new Map<string, Job[]>()
  for (const j of jobs) {
    const key = j.seriesId ? `s:${j.seriesId}:${amountOf(j)}:${whoOf(j)}:${routeText(j)}` : `j:${j.id}`
    groups.set(key, [...(groups.get(key) ?? []), j])
  }
  const lines: DocLine[] = [...groups.values()].map((g) => {
    const j = g[0]
    const km = g.reduce((s, x) => s + (x.distance ?? 0), 0)
    const advance = g.reduce((s, x) => s + (x.advance ?? 0), 0)
    if (g.length === 1) {
      return { date: fmtMD(j.date), text: `${routeText(j)}${km ? `（${km}km）` : ''}${whoOf(j)}`, advance, amount: amountOf(j) }
    }
    const last = g[g.length - 1]
    return {
      date: `${md(j.date)}〜${md(last.date)}`,
      text: `${routeText(j)}　${g.length}回 × @${amountOf(j).toLocaleString()}${km ? `（計${km.toLocaleString()}km）` : ''}${whoOf(j)}`,
      advance,
      amount: amountOf(j) * g.length,
    }
  })
  return {
    id: uid(),
    month,
    kind,
    partyKey,
    toName: to.name,
    honorific: to.honorific,
    toZip: to.zip,
    toAddress: to.address,
    number,
    issueDate: monthDays(`${month}-01`).at(-1)!,
    lines,
    note: kind === 'invoice' ? 'お振込期限：翌月末日\n恐れ入りますが、振込手数料は貴社にてご負担ください。' : 'お支払予定日：翌月末日',
    edited: false,
    sourceTotal: partyTotal(db, month, kind, partyKey),
  }
}

const md = (s: string) => `${+s.slice(5, 7)}/${+s.slice(8, 10)}`

/** 合計。立替金は税込の実費なので消費税の対象外として最後に足す */
export const docTotals = (doc: BillingDoc, taxRate: number) => {
  const subtotal = doc.lines.reduce((s, l) => s + (l.amount || 0), 0)
  const tax = doc.noTax ? 0 : Math.floor((subtotal * taxRate) / 100)
  const advance = doc.lines.reduce((s, l) => s + (l.advance || 0), 0)
  return { subtotal, tax, advance, total: subtotal + tax + advance }
}

const TITLE = { invoice: '請求書', payment: '支払明細書' }
const ymdJa = (s: string) => (s ? `${s.slice(0, 4)}年${+s.slice(5, 7)}月${+s.slice(8, 10)}日` : '')

/**
 * 帳票の編集画面。A4の見た目のまま直接書き換えられ、「印刷・PDF保存」でPDFにできる。
 * 印刷時は画面の他の部分を隠して帳票だけを出す（styles.css の body.doc-open）。
 */
export default function DocEditor({ doc, settings, onChange, onRegenerate, onClose }: {
  doc: BillingDoc
  settings: Settings
  onChange: (doc: BillingDoc) => void
  onRegenerate: () => void
  onClose: () => void
}) {
  useEffect(() => {
    document.body.classList.add('doc-open')
    return () => document.body.classList.remove('doc-open')
  }, [])
  const set = <K extends keyof BillingDoc>(k: K, v: BillingDoc[K]) => onChange({ ...doc, [k]: v, edited: true })
  const setLine = (i: number, patch: Partial<DocLine>) => set('lines', doc.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  const { subtotal, tax, advance, total } = docTotals(doc, settings.taxRate)
  const isInvoice = doc.kind === 'invoice'
  const fileName = `${TITLE[doc.kind]}_${doc.month}_${doc.toName}`

  const exportExcel = () => {
    const aoa: (string | number)[][] = [
      [TITLE[doc.kind]],
      [`${doc.toName} ${doc.honorific}`, '', `No. ${doc.number}`],
      [doc.toAddress, '', `発行日 ${ymdJa(doc.issueDate)}`],
      [],
      ['日付', '内容', '立替金（税込）', '金額（税抜）'],
      ...doc.lines.map((l) => [l.date, l.text, l.advance || '', l.amount]),
      [],
      ['', '小計（税抜）', '', subtotal],
      ['', doc.noTax ? '消費税' : `消費税（${settings.taxRate}%）`, '', tax],
      ['', '立替金（税込）', '', advance],
      ['', '合計', '', total],
      [],
      ['備考', doc.note],
    ]
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    ws['!cols'] = [{ wch: 16 }, { wch: 50 }, { wch: 14 }, { wch: 14 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, TITLE[doc.kind])
    XLSX.writeFile(wb, `${fileName}.xlsx`)
  }
  const print = () => {
    ;(document.activeElement as HTMLElement | null)?.blur() // 入力中の枠を印刷しない
    const prev = document.title
    document.title = fileName // PDF保存時のファイル名になる
    window.print()
    document.title = prev
  }

  return createPortal(
    <div className="doc-overlay">
      <div className="doc-toolbar">
        <button className="ghost" onClick={onClose}>← 閉じる</button>
        <b>{TITLE[doc.kind]}：{doc.toName}</b>
        <span className="spacer" />
        <label className="inline small"><input type="checkbox" checked={!!doc.noTax} onChange={(e) => set('noTax', e.target.checked)} />消費税なし</label>
        <button className="ghost" onClick={() => { if (confirm('管理表の内容から作り直しますか？\nこの帳票で編集した内容は消えます。')) onRegenerate() }}>管理表から作り直す</button>
        <button className="secondary" onClick={exportExcel}>Excel出力</button>
        <button onClick={print}>印刷・PDF保存</button>
      </div>
      <p className="doc-hint">白い用紙の部分は、クリックするとそのまま書き換えられます（自動で保存されます）。PDFにするには「印刷・PDF保存」を押し、印刷先で「PDFに保存」を選んでください。</p>

      <div className="doc-sheet">
        <h1 className="doc-title">{TITLE[doc.kind]}</h1>
        <div className="doc-meta">
          <div>No. <input value={doc.number} onChange={(e) => set('number', e.target.value)} /></div>
          <div>発行日 <input className="no-print" type="date" value={doc.issueDate} onChange={(e) => set('issueDate', e.target.value)} /><span className="print-only">{ymdJa(doc.issueDate)}</span></div>
        </div>
        <div className="doc-parties">
          <div className="doc-to">
            <div className="doc-zip">〒<input value={doc.toZip} onChange={(e) => set('toZip', e.target.value)} /></div>
            <input className="doc-addr" value={doc.toAddress} onChange={(e) => set('toAddress', e.target.value)} placeholder="住所" />
            <div className="doc-toname">
              <input value={doc.toName} onChange={(e) => set('toName', e.target.value)} />
              <input className="doc-hon" value={doc.honorific} onChange={(e) => set('honorific', e.target.value)} />
            </div>
            <p>{isInvoice ? '下記のとおりご請求申し上げます。' : '下記のとおりお支払いいたします。'}</p>
            <div className="doc-total-box">
              <span>{isInvoice ? 'ご請求金額' : 'お支払金額'}（税込）</span>
              <b>{yen(total)}</b>
            </div>
          </div>
          <div className="doc-from">
            <b>{settings.companyName}</b>
            <div>〒{settings.zip}</div>
            <div>{settings.address}</div>
            <div>TEL {settings.tel}</div>
            {settings.invoiceNo && <div>登録番号 {settings.invoiceNo}</div>}
          </div>
        </div>

        <table className="doc-lines">
          <thead><tr><th className="c-date">日付</th><th>内容</th><th className="c-amt">立替金（税込）</th><th className="c-amt">金額（税抜）</th><th className="no-print c-del"></th></tr></thead>
          <tbody>
            {doc.lines.map((l, i) => (
              <tr key={i}>
                <td><input value={l.date} onChange={(e) => setLine(i, { date: e.target.value })} /></td>
                <td><input value={l.text} onChange={(e) => setLine(i, { text: e.target.value })} /></td>
                <td>
                  <input className="amt no-print" type="number" value={l.advance || ''} onChange={(e) => setLine(i, { advance: +e.target.value })} />
                  <span className="print-only amt">{l.advance ? l.advance.toLocaleString() : ''}</span>
                </td>
                <td>
                  <input className="amt no-print" type="number" value={l.amount} onChange={(e) => setLine(i, { amount: +e.target.value })} />
                  <span className="print-only amt">{l.amount.toLocaleString()}</span>
                </td>
                <td className="no-print"><button className="ghost small" title="この行を削除" onClick={() => set('lines', doc.lines.filter((_, j) => j !== i))}>×</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="link no-print" onClick={() => set('lines', [...doc.lines, { date: '', text: '', advance: 0, amount: 0 }])}>＋ 行を追加（待機料・値引き・立替金など）</button>

        <table className="doc-sum">
          <tbody>
            <tr><th>小計（税抜）</th><td>{yen(subtotal)}</td></tr>
            <tr><th>{doc.noTax ? '消費税' : `消費税（${settings.taxRate}%）`}</th><td>{yen(tax)}</td></tr>
            <tr><th>立替金（税込・非課税）</th><td>{yen(advance)}</td></tr>
            <tr className="grand"><th>合計</th><td>{yen(total)}</td></tr>
          </tbody>
        </table>

        {isInvoice && settings.bank && (
          <div className="doc-bank"><b>お振込先</b>　{settings.bank}</div>
        )}
        <div className="doc-note">
          <b>備考</b>
          <textarea rows={3} value={doc.note} onChange={(e) => set('note', e.target.value)} />
        </div>
      </div>
    </div>,
    document.body,
  )
}
