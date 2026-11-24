export type ID = string

/** 委託区分: 個人 / 所属会社 / 自社正社員 */
export type DriverKind = 'individual' | 'company' | 'employee'

/** 帳票の宛先情報（正式名称など）。画面の表示は略称（name）を使う */
export interface PartyInfo {
  officialName?: string
  honorific?: string // 御中 / 様
  zip?: string
  address?: string
}

export interface Company extends PartyInfo {
  id: ID
  name: string // 略称
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
  /** 支払明細の宛先住所（個人委託） */
  zip?: string
  address?: string
  /** 所属会社のドライバーを、会社の行とは別に独立した行で表示する */
  ownRow?: boolean
}

export interface Client extends PartyInfo {
  id: ID
  name: string // 略称
  color: string
}

/** 定期案件の繰り返しルール */
export interface RecurRule {
  freq: 'daily' | 'dow' // 毎日 / 曜日選択
  dows: number[] // 曜日選択時の曜日（0=日〜6=土）
  holidays: boolean // 祝日も稼働するか
  interval: 1 | 2 | 0 // 1=毎週, 2=隔週, 0=開始週のみ（曜日選択時）
}

/** 固定業務（毎日固定の役割） / 定期案件（期間限定の定期案件など） */
export type SeriesType = 'fixed' | 'regular'

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
  /** カードの色（未指定なら請求先の色） */
  color?: string
  /** 繰り返しで一括生成された場合のシリーズID と その設定 */
  seriesId?: ID
  seriesType?: SeriesType
  seriesRule?: RecurRule
  seriesUntil?: string
  /** 複数台案件: 同じ日・同じ案件の車両をまとめるID と 何台目か */
  groupId?: ID
  groupIndex?: number
  /** 請求額 / 支払額（税抜, 円） */
  billAmount: number
  payAmount: number
  /** 距離（km）。後から手入力、または単価マスタの標準距離 */
  distance?: number
  /** 立替金（高速代・駐車代など。税込の実費で、請求・支払とも同額を消費税なしで計上） */
  advance?: number
  /** 適用した単価（単価マスタ） */
  rateId?: ID
}

/**
 * 単価マスタ（シーズン案件などの請求額・支払先ごとの支払額）。
 * 支払先のキーは "company:会社ID" / "driver:ドライバーID"。
 */
export interface Rate {
  id: ID
  name: string
  clientId: ID | null
  from: string // 適用期間（空=制限なし）
  to: string
  billAmount: number
  payDefault: number
  payByPayee: Record<string, number>
  distance?: number
  note: string
}

/** 帳票（請求書 / 支払明細書）。締め後に管理表から作成し、自由に編集できる */
export interface DocLine {
  date: string
  text: string
  advance?: number // 立替金（税込）
  amount: number // 金額（税抜）
}
export interface BillingDoc {
  id: ID
  month: string // YYYY-MM
  kind: 'invoice' | 'payment'
  partyKey: string // "client:ID" / "company:ID" / "driver:ID"
  toName: string
  honorific: string
  toZip: string
  toAddress: string
  number: string
  issueDate: string
  lines: DocLine[]
  note: string
  edited: boolean
  /** 消費税を計算しない（免税の個人ドライバーへの支払など） */
  noTax?: boolean
  /** 作成時の管理表の合計（金額＋立替金）。管理表がその後変わったかの判定に使う */
  sourceTotal?: number
}

/** 自社情報（帳票の発行元） */
export interface Settings {
  companyName: string
  zip: string
  address: string
  tel: string
  invoiceNo: string // 適格請求書発行事業者 登録番号
  bank: string // 振込先
  taxRate: number // %
}

/** 案件ではないメモ用カード */
export interface Memo {
  id: ID
  date: string
  driverId: ID | null // null = 担当者未定の行に表示
  time: string
  text: string
  color: string
}

/** 通常休暇 / 希望休 */
export type LeaveKind = 'normal' | 'request'

export interface Leave {
  id: ID
  driverId: ID
  date: string
  kind?: LeaveKind // 未指定は通常休暇
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
  memos: Memo[]
  vehicles: Vehicle[]
  rates: Rate[]
  /** 締めた月（YYYY-MM） */
  closedMonths: string[]
  docs: BillingDoc[]
  settings: Settings
  /** 予定表の行の並び順（"d:ドライバーID" / "c:会社ID"）。会社内の並びは drivers の配列順 */
  rowOrder?: string[]
}
