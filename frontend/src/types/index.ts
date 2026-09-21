export interface Tick { time: string; price: number; bid: number; ask: number; volume: number }
export interface OrderBook { bids: [number,number][]; asks: [number,number][]; midPrice: number; spread: number }
export interface GridConfig { lowerPrice: number; upperPrice: number; gridCount: number; capitalPerGrid: number; initialCapital: number }
export interface GridOrder { id: number; price: number; side: string; quantity: number; status: string; profit: number }
export interface GridResult { orders: GridOrder[]; totalProfit: number; returnRate: number; sharpeRatio: number; maxDrawdown: number; winRate: number; equityCurve: number[] }

/** 告警处置状态：待处理 -> 已确认 -> 已恢复（只允许正向流转） */
export type AlertStatus = 'pending' | 'acknowledged' | 'recovered'
/** 告警类型：价格越界 / 网格亏损 */
export type AlertKind = 'price_breach' | 'grid_loss'

export interface AlertItem {
  id: number
  kind: AlertKind
  title: string
  detail: string
  triggerPrice?: number
  createdAt: number
  status: AlertStatus
  /** 确认时填写的处置说明 */
  note: string
  acknowledgedAt?: number
  recoveredAt?: number
  /** 恢复方式：自动恢复 / 手动恢复 */
  recoverReason?: 'auto' | 'manual'
}
