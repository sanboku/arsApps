import { useCallback, useEffect, useState } from 'react'
import JapaneseHolidays from 'japanese-holidays'
import type { DB, Driver, Job, LeaveKind, PartyInfo, Piece, Rate, RecurRule, SeriesType, Settings } from './types'

// ---- 日付ユーティリティ（ローカル日付を YYYY-MM-DD で扱う） ----
export const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export const parseYmd = (s: string) => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}
export const addDays = (s: string, n: number) => {
  const d = parseYmd(s)
  d.setDate(d.getDate() + n)
  return ymd(d)
}
export const today = () => ymd(new Date())
/** その日を含む週の月曜日 */
export const weekStart = (s: string) => {
  const d = parseYmd(s)
  const diff = (d.getDay() + 6) % 7
  return addDays(s, -diff)
}
export const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']
export const fmtMD = (s: string) => {
  const d = parseYmd(s)
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]})`
}
export const daysUntil = (s: string) =>
  Math.round((parseYmd(s).getTime() - parseYmd(today()).getTime()) / 86400000)

export const uid = () => Math.random().toString(36).slice(2, 10)
export const yen = (n: number) => `¥${(n || 0).toLocaleString()}`

/** 祝日名（祝日でなければ undefined） */
export const holidayName = (s: string): string | undefined => JapaneseHolidays.isHoliday(parseYmd(s)) || undefined

export const monthStart = (s: string) => `${s.slice(0, 7)}-01`
export const monthDays = (s: string) => {
  const first = monthStart(s)
  const d = parseYmd(first)
  const n = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  return Array.from({ length: n }, (_, i) => addDays(first, i))
}

/** 午前/午後の判定（時間未設定は午前扱い） */
export const isPM = (j: Job) => (j.pickupTime || j.dropoffTime || '00:00') >= '12:00'
/** 時間の早い順（時間未設定は先頭） */
export const byTime = (a: Job, b: Job) =>
  (a.pickupTime || a.dropoffTime).localeCompare(b.pickupTime || b.dropoffTime) || (a.groupIndex ?? 0) - (b.groupIndex ?? 0)

/** カード等に出す行先表示。降ろし地が空なら業務名（積み地欄）のみ */
export const routeText = (j: Job) => {
  const p = j.pickups.filter(Boolean).join('・')
  const d = j.dropoffs.filter(Boolean).join('・')
  return d ? `${p || '—'} 〜 ${d}` : p || '—'
}

/** 背景色に対して読みやすい文字色 */
export const textColorFor = (hex: string) => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) return '#fff'
  const [r, g, b] = m.slice(1).map((x) => parseInt(x, 16))
  return r * 0.299 + g * 0.587 + b * 0.114 > 160 ? '#1f2937' : '#fff'
}

export const CARD_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#64748b', '#fde68a', '#bbf7d0', '#bfdbfe', '#fecaca']

/**
 * 予定表の行の並び順（"d:ID" = 自社・個人ドライバー, "c:ID" = 委託会社）。
 * rowOrder に無い行は 正社員 → 個人 → 独立行の所属ドライバー → 会社 の順で末尾に追加する。
 */
export function orderedRowKeys(db: DB): string[] {
  const all = [
    ...db.drivers.filter((d) => d.kind === 'employee').map((d) => `d:${d.id}`),
    ...db.drivers.filter((d) => d.kind === 'individual').map((d) => `d:${d.id}`),
    ...db.drivers.filter(hasOwnRow).map((d) => `d:${d.id}`),
    ...db.companies.map((c) => `c:${c.id}`),
  ]
  const valid = new Set(all)
  const saved = (db.rowOrder ?? []).filter((k) => valid.has(k))
  return [...saved, ...all.filter((k) => !saved.includes(k))]
}

/** 所属会社のドライバーで、独立した行で表示するもの */
export const hasOwnRow = (d: Driver) => d.kind === 'company' && !!d.ownRow

/** 指定ドライバーの、ある月（YYYY-MM）の休暇日数（通常休暇・希望休の合計） */
export const leaveCount = (db: DB, driverId: string, ym: string) =>
  db.leaves.filter((l) => l.driverId === driverId && l.date.startsWith(ym)).length

export const LEAVE_LABEL: Record<LeaveKind, { short: string; long: string }> = {
  normal: { short: '休', long: '通常休暇' },
  request: { short: '希', long: '希望休' },
}

// ---- 請求・支払 ----

/** 支払先。所属会社のドライバーは会社、個人委託はその人、自社正社員は支払対象外 */
export type Payee = { key: string; short: string; kind: 'company' | 'driver' | 'self' } & PartyInfo
export function payeeOf(db: DB, driverId: string | null): Payee | null {
  const d = db.drivers.find((x) => x.id === driverId)
  if (!d) return null
  if (d.kind === 'employee') return { key: 'self', short: '自社', kind: 'self' }
  if (d.kind === 'company') {
    const c = db.companies.find((x) => x.id === d.companyId)
    if (c) return { key: `company:${c.id}`, short: c.name, kind: 'company', officialName: c.officialName || c.name, honorific: c.honorific || '御中', zip: c.zip, address: c.address }
  }
  return { key: `driver:${d.id}`, short: d.displayName, kind: 'driver', officialName: d.fullName, honorific: '様', zip: d.zip, address: d.address }
}

/** 締め済みの月か */
export const isClosed = (db: DB, date: string) => db.closedMonths.includes(date.slice(0, 7))

/** 利益率（%）。請求額が0なら null */
export const profitRate = (bill: number, pay: number) => (bill ? Math.round(((bill - pay) / bill) * 1000) / 10 : null)

/** 単価マスタのうち、その日・その請求先で使えるもの */
export const ratesFor = (db: DB, date: string, clientId: string | null) =>
  db.rates.filter((r) => (!r.clientId || !clientId || r.clientId === clientId) && (!r.from || date >= r.from) && (!r.to || date <= r.to))

/** 単価マスタから、支払先に応じた支払額 */
export const payFromRate = (r: Rate, payeeKey: string | undefined) => (payeeKey && payeeKey in r.payByPayee ? r.payByPayee[payeeKey] : r.payDefault)
/** 個配なら数量×単価で請求額・支払額を計算し直す */
export const withPiece = (j: Job): Job => (j.piece ? { ...j, billAmount: j.piece.qty * j.piece.billUnit, payAmount: j.piece.qty * j.piece.payUnit } : j)

/** 個配の表示（例：120個 × @100） */
export const pieceText = (p: Piece, unitPrice: number) => `${p.qty.toLocaleString()}${p.unit} × @${unitPrice.toLocaleString()}`

/** 担当者が変わったときの支払額（単価マスタ適用中なら支払先に応じた額・単価に） */
export function repriceForDriver(db: DB, j: Job, driverId: string | null): Job {
  const r = db.rates.find((x) => x.id === j.rateId)
  if (!r) return { ...j, driverId }
  if (j.piece) return withPiece({ ...j, driverId, piece: { ...j.piece, payUnit: ratePay(db, r, driverId) } })
  return { ...j, driverId, payAmount: ratePay(db, r, driverId) }
}

/** 単価マスタから、担当者に応じた支払額（自社正社員は0） */
export const ratePay = (db: DB, r: Rate, driverId: string | null) => {
  const p = payeeOf(db, driverId)
  return p?.kind === 'self' ? 0 : payFromRate(r, p?.key)
}

export const DEFAULT_SETTINGS: Settings = {
  companyName: '株式会社サンプル運送',
  zip: '000-0000',
  address: '東京都〇〇区〇〇 1-2-3',
  tel: '03-0000-0000',
  invoiceNo: 'T0000000000000',
  bank: '〇〇銀行 〇〇支店 普通 1234567 カ）サンプルウンソウ',
  taxRate: 10,
}

export const WEEKDAYS_MON_FIRST = [1, 2, 3, 4, 5, 6, 0]

/** 定期案件の発生日を列挙 */
export function recurDates(start: string, end: string, rule: RecurRule): string[] {
  const out: string[] = []
  const ws = weekStart(start)
  // 終了日未定の場合は1年先まで作成
  const last = rule.freq === 'dow' && rule.interval === 0 ? addDays(ws, 6) : end || addDays(start, 365)
  for (let d = start; d <= last && out.length < 400; d = addDays(d, 1)) {
    if (!rule.holidays && holidayName(d)) continue
    if (rule.freq === 'dow') {
      if (!rule.dows.includes(parseYmd(d).getDay())) continue
      const week = Math.floor((parseYmd(d).getTime() - parseYmd(ws).getTime()) / (7 * 86400000))
      if (rule.interval === 2 && week % 2 === 1) continue
    }
    out.push(d)
  }
  return out
}

export const emptyJob = (p: Partial<Job> = {}): Job => ({
  id: uid(),
  date: today(),
  driverId: null,
  clientId: null,
  pickups: [''],
  dropoffs: [''],
  pickupTime: '',
  dropoffTime: '',
  note: '',
  billAmount: 0,
  payAmount: 0,
  ...p,
})

// ---- 初期サンプルデータ ----
// 今月の1日〜来月末までの予定を、見やすい件数で用意する（社名・人名はすべて架空）
function seed(): DB {
  const m0 = monthStart(today())
  const next = monthDays(addDays(monthDays(m0).at(-1)!, 1))
  const until = next.at(-1)! // 来月末
  const day = (n: number) => addDays(m0, n - 1) // 今月のn日
  const weekdays: RecurRule = { freq: 'dow', dows: [1, 2, 3, 4, 5], holidays: false, interval: 1 }

  const db: DB = {
    companies: [
      { id: 'c1', name: 'E運送', officialName: '株式会社E運送', honorific: '御中', zip: '272-0001', address: '千葉県市川市サンプル町 4-5-6' },
      { id: 'c2', name: 'F急便', officialName: 'F急便株式会社', honorific: '御中', zip: '340-0001', address: '埼玉県草加市サンプル町 7-8-9' },
    ],
    drivers: [
      { id: 'd1', fullName: '山田 太郎', kana: 'やまだ たろう', phone: '090-0000-0001', displayName: '山田', kind: 'employee', showOnCalendar: true },
      { id: 'd2', fullName: '中村 健', kana: 'なかむら けん', phone: '090-0000-0002', displayName: '中村', kind: 'employee', showOnCalendar: true },
      { id: 'd3', fullName: '佐藤 次郎', kana: 'さとう じろう', phone: '090-0000-0003', displayName: '佐藤', kind: 'individual', showOnCalendar: true, zip: '135-0001', address: '東京都江東区サンプル 1-2-3' },
      { id: 'd4', fullName: '鈴木 三郎', kana: 'すずき さぶろう', phone: '090-0000-0004', displayName: '鈴木', kind: 'individual', showOnCalendar: true, zip: '120-0001', address: '東京都足立区サンプル 4-5-6' },
      { id: 'd5', fullName: '伊藤 六郎', kana: 'いとう ろくろう', phone: '090-0000-0005', displayName: '伊藤', kind: 'individual', showOnCalendar: false },
      { id: 'd6', fullName: '高橋 四郎', kana: 'たかはし しろう', phone: '090-0000-0006', displayName: '高橋(E)', kind: 'company', companyId: 'c1', showOnCalendar: true },
      { id: 'd7', fullName: '田中 五郎', kana: 'たなか ごろう', phone: '090-0000-0007', displayName: '田中(E)', kind: 'company', companyId: 'c1', showOnCalendar: true, ownRow: true },
      { id: 'd8', fullName: '小林 七海', kana: 'こばやし ななみ', phone: '090-0000-0008', displayName: '小林(F)', kind: 'company', companyId: 'c2', showOnCalendar: true },
      { id: 'd9', fullName: '加藤 八郎', kana: 'かとう はちろう', phone: '090-0000-0009', displayName: '加藤(F)', kind: 'company', companyId: 'c2', showOnCalendar: true },
    ],
    clients: [
      { id: 'k1', name: 'A物流', color: '#3b82f6', officialName: '株式会社A物流', honorific: '御中', zip: '135-0000', address: '東京都江東区サンプル 1-1-1' },
      { id: 'k2', name: 'B商事', color: '#10b981', officialName: 'B商事株式会社', honorific: '御中', zip: '210-0000', address: '神奈川県川崎市サンプル 2-2-2' },
      { id: 'k3', name: 'C通販', color: '#f59e0b', officialName: '株式会社C通販', honorific: '御中', zip: '272-0000', address: '千葉県市川市サンプル 3-3-3' },
      { id: 'k4', name: 'D食品', color: '#8b5cf6', officialName: 'D食品株式会社', honorific: '御中', zip: '330-0000', address: '埼玉県さいたま市サンプル 4-4-4' },
    ],
    jobs: [],
    rates: [
      { id: 'r1', name: 'A物流 定期便', clientId: 'k1', from: '', to: '', billAmount: 25000, payDefault: 18000, payByPayee: {}, distance: 60, note: '平日毎日の固定業務' },
      { id: 'r2', name: '年末増便（A物流）', clientId: 'k1', from: `${today().slice(0, 4)}-12-01`, to: `${today().slice(0, 4)}-12-31`, billAmount: 30000, payDefault: 21000, payByPayee: { 'company:c1': 22000 }, distance: 45, note: '12月限定。E運送は22,000円' },
      { id: 'r3', name: 'D食品 冷凍便', clientId: 'k4', from: '', to: '', billAmount: 22000, payDefault: 17000, payByPayee: {}, distance: 50, note: '' },
      { id: 'r4', name: 'C通販 個配', clientId: 'k3', from: '', to: '', billAmount: 100, payDefault: 80, payByPayee: { 'company:c2': 75 }, note: '1個あたり。F急便は75円', mode: 'piece', unit: '個' },
    ],
    closedMonths: [],
    docs: [],
    settings: DEFAULT_SETTINGS,
    leaves: [],
    memos: [
      { id: uid(), date: today(), driverId: null, time: '', text: 'A物流より12月の増便の打診あり', color: '#fde68a' },
      { id: uid(), date: addDays(today(), 1), driverId: 'd4', time: '13:00', text: '車両点検（午後）', color: '#bfdbfe' },
      { id: uid(), date: day(3), driverId: null, time: '', text: 'C通販 個配エリア拡大の相談（来月から）', color: '#fde68a' },
      { id: uid(), date: day(16), driverId: 'd3', time: '09:00', text: '佐藤さん 健康診断のため出発遅れ', color: '#fecaca' },
    ],
    vehicles: [
      { id: 'v1', plate: '品川 480 あ 12-34', name: 'ハイゼット', inspectionDate: addDays(today(), 20), lentTo: '佐藤', lastUsed: addDays(today(), -1), repairs: [{ date: addDays(today(), -60), description: 'タイヤ交換', cost: 32000 }] },
      { id: 'v2', plate: '品川 480 い 56-78', name: 'エブリイ', inspectionDate: addDays(today(), 200), lentTo: '', lastUsed: addDays(today(), -10), repairs: [] },
      { id: 'v3', plate: '足立 480 う 90-12', name: 'NV200', inspectionDate: addDays(today(), 45), lentTo: '鈴木', lastUsed: today(), repairs: [{ date: addDays(today(), -120), description: 'オイル交換', cost: 6800 }] },
    ],
  }

  /** 繰り返しの案件を今月1日〜来月末まで作る */
  const series = (type: SeriesType, rule: RecurRule, p: Partial<Job>) => {
    const sid = uid()
    for (const d of recurDates(m0, until, rule)) db.jobs.push(emptyJob({ ...p, date: d, seriesId: sid, seriesType: type, seriesRule: rule, seriesUntil: until }))
  }
  // 固定業務：社員2名が平日毎日（社員なので支払額は0）
  series('fixed', weekdays, { driverId: 'd1', clientId: 'k1', pickups: ['A物流 定期便'], dropoffs: [], pickupTime: '08:00', billAmount: 25000, payAmount: 0, distance: 60, rateId: 'r1' })
  series('fixed', weekdays, { driverId: 'd2', clientId: 'k2', pickups: ['B商事 午後便'], dropoffs: [], pickupTime: '13:00', billAmount: 18000, payAmount: 0, distance: 40 })
  // 定期案件：個人委託（月水金）と、E運送の田中さん（火木・高速代あり）
  series('regular', { ...weekdays, dows: [1, 3, 5] }, { driverId: 'd3', clientId: 'k3', pickups: ['C通販 市川DC'], dropoffs: ['千葉市内'], pickupTime: '09:00', billAmount: 16000, payAmount: 12000, distance: 35 })
  series('regular', { ...weekdays, dows: [2, 4] }, { driverId: 'd7', clientId: 'k4', pickups: ['D食品 冷凍便'], dropoffs: [], pickupTime: '14:00', billAmount: 22000, payAmount: 17000, distance: 50, advance: 800, rateId: 'r3' })

  // 個配（数量×単価）：F急便の小林さんが火木土。数量は実績のある過去日だけ入れておく
  series('regular', { ...weekdays, dows: [2, 4, 6] }, { driverId: 'd8', clientId: 'k3', pickups: ['C通販 個配（市川エリア）'], dropoffs: [], pickupTime: '10:00', rateId: 'r4', piece: { unit: '個', qty: 0, billUnit: 100, payUnit: 75 } })
  db.jobs = db.jobs.map((j, i) => (j.piece && j.date < today() ? withPiece({ ...j, piece: { ...j.piece, qty: 110 + ((i * 17) % 60) } }) : j))

  // 単発の案件
  const gid = uid()
  db.jobs.push(
    emptyJob({ date: day(6), driverId: 'd4', clientId: 'k1', pickups: ['A物流 東雲センター'], dropoffs: ['羽田'], pickupTime: '10:00', billAmount: 18000, payAmount: 13000, distance: 25, advance: 1200, note: '首都高利用' }),
    emptyJob({ date: day(12), driverId: 'd8', clientId: 'k3', pickups: ['C通販 市川DC'], dropoffs: ['船橋'], pickupTime: '07:00', groupId: gid, groupIndex: 1, billAmount: 15000, payAmount: 11000, distance: 20 }),
    emptyJob({ date: day(12), driverId: 'd9', clientId: 'k3', pickups: ['C通販 市川DC'], dropoffs: ['船橋'], pickupTime: '07:00', groupId: gid, groupIndex: 2, billAmount: 15000, payAmount: 11000, distance: 20 }),
    emptyJob({ date: day(18), driverId: 'd4', clientId: 'k2', pickups: ['B商事 川崎倉庫'], dropoffs: ['横浜市内', '藤沢市'], pickupTime: '13:30', billAmount: 30000, payAmount: 22000, distance: 70, advance: 1500 }),
    emptyJob({ date: addDays(today(), 2), driverId: null, clientId: 'k2', pickups: ['B商事 本社'], dropoffs: ['大宮'], pickupTime: '14:00', billAmount: 20000, payAmount: 15000, note: '担当未定・要調整' }),
    emptyJob({ date: addDays(today(), 3), driverId: 'd6', clientId: 'k1', pickups: ['A物流 スポット便'], dropoffs: [], pickupTime: '09:00', billAmount: 20000, payAmount: 15000, distance: 30 }),
  )

  // 過去の案件は完了済みにしておく
  db.jobs = db.jobs.map((j) => (j.date < today() ? { ...j, done: true } : j))

  // 休暇：案件のない日に入れる
  const free = (driverId: string, from: string) => {
    for (let d = from; d <= until; d = addDays(d, 1)) if (!db.jobs.some((j) => j.driverId === driverId && j.date === d)) return d
    return from
  }
  db.leaves.push(
    { id: uid(), driverId: 'd1', date: free('d1', addDays(weekStart(today()), 5)) },
    { id: uid(), driverId: 'd3', date: free('d3', addDays(today(), 1)), kind: 'request' },
    { id: uid(), driverId: 'd4', date: free('d4', addDays(today(), 2)) },
  )
  return db
}

const KEY = 'arsapps-db-v3' // データ構造を変えたらバージョンを上げる（サンプル版は初期データに戻る）
const load = (): DB => {
  try {
    // 古い形式のデータは使わないので消しておく
    for (const old of ['arsapps-db-v1', 'arsapps-db-v2']) localStorage.removeItem(old)
    const raw = localStorage.getItem(KEY)
    if (raw) return { memos: [], rates: [], closedMonths: [], docs: [], settings: DEFAULT_SETTINGS, ...JSON.parse(raw) } // 後から追加した項目は既定値で補う
  } catch {
    /* noop */
  }
  return seed()
}

/**
 * サンプル版はブラウザの localStorage に保存。
 * 本番では Supabase などのDBに置き換える（このフックの中身を差し替えるだけで済む構成）。
 */
export function useDB() {
  const [db, setDb] = useState<DB>(load)
  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(db))
  }, [db])
  const update = useCallback((fn: (draft: DB) => DB) => setDb((prev) => fn(prev)), [])
  const reset = useCallback(() => setDb(seed()), [])
  return { db, update, reset }
}
export type Store = ReturnType<typeof useDB>
