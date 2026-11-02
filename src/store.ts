import { useCallback, useEffect, useState } from 'react'
import JapaneseHolidays from 'japanese-holidays'
import type { DB, Job, RecurRule } from './types'

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
  return d ? `${p || '—'} → ${d}` : p || '—'
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
 * rowOrder に無い行は 正社員 → 個人 → 会社 の順で末尾に追加する。
 */
export function orderedRowKeys(db: DB): string[] {
  const all = [
    ...db.drivers.filter((d) => d.kind === 'employee').map((d) => `d:${d.id}`),
    ...db.drivers.filter((d) => d.kind === 'individual').map((d) => `d:${d.id}`),
    ...db.companies.map((c) => `c:${c.id}`),
  ]
  const valid = new Set(all)
  const saved = (db.rowOrder ?? []).filter((k) => valid.has(k))
  return [...saved, ...all.filter((k) => !saved.includes(k))]
}

/** 指定ドライバーの、ある月（YYYY-MM）の休暇日数 */
export const leaveCount = (db: DB, driverId: string, ym: string) =>
  db.leaves.filter((l) => l.driverId === driverId && l.date.startsWith(ym)).length

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
function seed(): DB {
  const ws = weekStart(today())
  const db: DB = {
    companies: [{ id: 'c1', name: '株式会社ABC運送' }],
    drivers: [
      { id: 'd1', fullName: '山田 太郎', kana: 'やまだ たろう', phone: '090-1111-1111', displayName: '山田', kind: 'employee', showOnCalendar: true },
      { id: 'd2', fullName: '佐藤 次郎', kana: 'さとう じろう', phone: '090-2222-2222', displayName: '佐藤', kind: 'individual', showOnCalendar: true },
      { id: 'd3', fullName: '鈴木 三郎', kana: 'すずき さぶろう', phone: '090-3333-3333', displayName: '鈴木', kind: 'individual', showOnCalendar: true },
      { id: 'd4', fullName: '高橋 四郎', kana: 'たかはし しろう', phone: '090-4444-4444', displayName: '高橋(ABC)', kind: 'company', companyId: 'c1', showOnCalendar: true },
      { id: 'd5', fullName: '田中 五郎', kana: 'たなか ごろう', phone: '090-5555-5555', displayName: '田中(ABC)', kind: 'company', companyId: 'c1', showOnCalendar: true },
      { id: 'd6', fullName: '伊藤 六郎', kana: 'いとう ろくろう', phone: '090-6666-6666', displayName: '伊藤', kind: 'individual', showOnCalendar: false },
    ],
    clients: [
      { id: 'k1', name: '〇〇物流', color: '#3b82f6' },
      { id: 'k2', name: '△△商事', color: '#10b981' },
      { id: 'k3', name: '□□ネット通販', color: '#f59e0b' },
    ],
    jobs: [],
    leaves: [{ id: uid(), driverId: 'd3', date: addDays(ws, 2) }, { id: uid(), driverId: 'd1', date: addDays(ws, 5) }],
    memos: [
      { id: uid(), date: addDays(ws, 1), driverId: null, time: '', text: '〇〇物流 年末増便の打診あり', color: '#fde68a' },
      { id: uid(), date: addDays(ws, 3), driverId: 'd2', time: '13:00', text: '車両点検（午後）', color: '#bfdbfe' },
    ],
    vehicles: [
      { id: 'v1', plate: '品川 480 あ 12-34', name: 'ハイゼット', inspectionDate: addDays(today(), 20), lentTo: '佐藤', lastUsed: addDays(today(), -1), repairs: [{ date: addDays(today(), -60), description: 'タイヤ交換', cost: 32000 }] },
      { id: 'v2', plate: '品川 480 い 56-78', name: 'エブリイ', inspectionDate: addDays(today(), 200), lentTo: '', lastUsed: addDays(today(), -10), repairs: [] },
    ],
  }
  // 山田さんは毎日固定（固定業務）
  const sid = uid()
  const fixedRule: RecurRule = { freq: 'dow', dows: [1, 2, 3, 4, 5], holidays: false, interval: 1 }
  const fixedUntil = addDays(ws, 34)
  for (const d of recurDates(ws, fixedUntil, fixedRule))
    db.jobs.push(emptyJob({ date: d, driverId: 'd1', clientId: 'k1', pickups: ['〇〇便業務'], dropoffs: [], pickupTime: '08:00', seriesId: sid, seriesType: 'fixed', seriesRule: fixedRule, seriesUntil: fixedUntil, billAmount: 25000, payAmount: 18000, note: '固定ルート' }))
  const gid = uid()
  db.jobs.push(
    emptyJob({ date: addDays(ws, 1), driverId: 'd2', clientId: 'k2', pickups: ['△△商事 川崎倉庫'], dropoffs: ['横浜市内', '藤沢市'], pickupTime: '13:30', dropoffTime: '16:00', billAmount: 30000, payAmount: 22000 }),
    emptyJob({ date: addDays(ws, 1), driverId: 'd2', clientId: 'k3', pickups: ['□□ 市川DC'], dropoffs: ['船橋'], pickupTime: '07:00', dropoffTime: '09:00', billAmount: 15000, payAmount: 11000 }),
    emptyJob({ date: addDays(ws, 2), driverId: 'd4', clientId: 'k3', pickups: ['□□ 市川DC'], dropoffs: ['千葉市内'], pickupTime: '09:00', groupId: gid, groupIndex: 1, billAmount: 25000, payAmount: 19000 }),
    emptyJob({ date: addDays(ws, 2), driverId: 'd5', clientId: 'k3', pickups: ['□□ 市川DC'], dropoffs: ['千葉市内'], pickupTime: '09:00', groupId: gid, groupIndex: 2, billAmount: 25000, payAmount: 19000 }),
    emptyJob({ date: addDays(ws, 3), driverId: null, clientId: 'k2', pickups: ['△△商事 本社'], dropoffs: ['大宮'], pickupTime: '14:00', note: '担当未定・要調整', billAmount: 20000, payAmount: 15000 }),
    emptyJob({ date: addDays(ws, 4), driverId: 'd3', clientId: 'k1', pickups: ['〇〇物流 東雲センター'], dropoffs: ['羽田'], pickupTime: '15:00', billAmount: 18000, payAmount: 13000 }),
  )
  return db
}

const KEY = 'arsapps-db-v2' // データ構造を変えたらバージョンを上げる（サンプル版は初期データに戻る）
const load = (): DB => {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { memos: [], ...JSON.parse(raw) } // 後から追加した項目は空で補う
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
