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

/** 定期案件の繰り返しルール */
export interface RecurRule {
  freq: 'daily' | 'dow' // 毎日 / 曜日選択
  dows: number[] // 曜日選択時の曜日（0=日〜6=土）
  holidays: boolean // 祝日も稼働するか
  interval: 1 | 2 | 0 // 1=毎週, 2=隔週, 0=開始週のみ（曜日選択時）
}

export interface Job {
  id: ID
  date: string // YYYY-MM-DD
  driverId: ID | null // null = 担当者未定
  clientId: ID | null
  /** 積み地。降ろし地が空の場合は「○○便業務」など業務名として扱う */
  pickups: string[]
  dropoffs: string[]
  pickupTime: string // HH:MM（空=未設定）
  dropoffTime: string
  note: string
  /** 定期案件として一括生成された場合のシリーズID */
  seriesId?: ID
  /** 複数台案件: 同じ日・同じ案件の車両をまとめるID と 何台目か */
  groupId?: ID
  groupIndex?: number
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
