export interface Tick { time: string; price: number; bid: number; ask: number; volume: number }
export interface OrderBook { bids: [number,number][]; asks: [number,number][]; midPrice: number; spread: number }
export interface GridConfig { lowerPrice: number; upperPrice: number; gridCount: number; capitalPerGrid: number; initialCapital: number }
export interface GridOrder { id: number; price: number; side: string; quantity: number; status: string; profit: number }
export interface GridResult { orders: GridOrder[]; totalProfit: number; returnRate: number; sharpeRatio: number; maxDrawdown: number; winRate: number; equityCurve: number[] }

// 告警处置状态：待处理 -> 已确认 -> 已恢复，不允许跳变
export type AlertStatus = 'PENDING' | 'ACKED' | 'RECOVERED'
export type AlertType = 'PRICE_BREACH' | 'GRID_LOSS'

export interface AlertItem {
  id: number
  type: AlertType
  title: string
  detail: string
  price: number
  time: string               // 告警发生时间
  status: AlertStatus
  active: boolean            // 触发条件当前是否仍然存在
  note: string               // 处置说明（确认时填写）
  ackTime: string | null     // 确认时间
  recoverTime: string | null // 恢复时间
}
