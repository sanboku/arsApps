export type ID = string

/** 委託区分: 個人 / 所属会社 / 自社正社員 */
export type DriverKind = 'individual' | 'company' | 'employee'

export interface Company {
  id: ID
  name: string
}

export interface Driver {
  id: ID
  fullName: string
  kana: string
  phone: string
  displayName: string
  kind: DriverKind
  companyId?: ID // kind === 'company' のとき
  showOnCalendar: boolean
}

export interface Client {
  id: ID
  name: string
  color: string
}

export type RecurFreq = 'daily' | 'weekdays' | 'weekly'

export interface Job {
  id: ID
  date: string // YYYY-MM-DD
  driverId: ID | null // null = 担当者未定
  clientId: ID | null
  pickups: string[]
  dropoffs: string[]
  vehicles: number
  note: string
  /** 定期案件として一括生成された場合のシリーズID */
  seriesId?: ID
  /** 請求額 / 支払額（税抜, 円） */
  billAmount: number
  payAmount: number
}

export interface Leave {
  id: ID
  driverId: ID
  date: string
}

export interface Repair {
  date: string
  description: string
  cost: number
}

export interface Vehicle {
  id: ID
  plate: string
  name: string
  inspectionDate: string // 車検満了日
  lentTo: string // 貸出先（ドライバー名など自由入力）
  lastUsed: string
  repairs: Repair[]
}

export interface DB {
  companies: Company[]
  drivers: Driver[]
  clients: Client[]
  jobs: Job[]
  leaves: Leave[]
  vehicles: Vehicle[]
}
