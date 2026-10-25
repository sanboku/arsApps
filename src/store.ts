import { useCallback, useEffect, useState } from 'react'
import type { DB, Job, RecurFreq } from './types'

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

/** 定期案件の発生日を列挙 */
export function recurDates(start: string, end: string, freq: RecurFreq): string[] {
  const out: string[] = []
  const startDow = parseYmd(start).getDay()
  for (let d = start; d <= end && out.length < 400; d = addDays(d, 1)) {
    const dow = parseYmd(d).getDay()
    if (freq === 'daily') out.push(d)
    else if (freq === 'weekdays' && dow >= 1 && dow <= 5) out.push(d)
    else if (freq === 'weekly' && dow === startDow) out.push(d)
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
  vehicles: 1,
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
    leaves: [{ id: uid(), driverId: 'd3', date: addDays(ws, 2) }],
    vehicles: [
      { id: 'v1', plate: '品川 480 あ 12-34', name: 'ハイゼット', inspectionDate: addDays(today(), 20), lentTo: '佐藤', lastUsed: addDays(today(), -1), repairs: [{ date: addDays(today(), -60), description: 'タイヤ交換', cost: 32000 }] },
      { id: 'v2', plate: '品川 480 い 56-78', name: 'エブリイ', inspectionDate: addDays(today(), 200), lentTo: '', lastUsed: addDays(today(), -10), repairs: [] },
    ],
  }
  // 山田さんは毎日固定（基本割り当て）
  const sid = uid()
  for (const d of recurDates(ws, addDays(ws, 27), 'weekdays'))
    db.jobs.push(emptyJob({ date: d, driverId: 'd1', clientId: 'k1', pickups: ['〇〇物流 東雲センター'], dropoffs: ['都内ルート配送'], seriesId: sid, billAmount: 25000, payAmount: 18000, note: '固定ルート' }))
  db.jobs.push(
    emptyJob({ date: addDays(ws, 1), driverId: 'd2', clientId: 'k2', pickups: ['△△商事 川崎倉庫'], dropoffs: ['横浜市内', '藤沢市'], billAmount: 30000, payAmount: 22000 }),
    emptyJob({ date: addDays(ws, 2), driverId: 'd4', clientId: 'k3', pickups: ['□□ 市川DC'], dropoffs: ['千葉市内'], vehicles: 2, billAmount: 50000, payAmount: 38000 }),
    emptyJob({ date: addDays(ws, 3), driverId: null, clientId: 'k2', pickups: ['△△商事 本社'], dropoffs: ['大宮'], note: '担当未定・要調整', billAmount: 20000, payAmount: 15000 }),
    emptyJob({ date: addDays(ws, 4), driverId: 'd5', clientId: 'k1', pickups: ['〇〇物流 東雲センター'], dropoffs: ['羽田'], billAmount: 18000, payAmount: 13000 }),
  )
  return db
}

const KEY = 'arsapps-db-v1'
const load = (): DB => {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw)
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
