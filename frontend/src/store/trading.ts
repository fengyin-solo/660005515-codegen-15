import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import axios from 'axios'
import type { Tick, OrderBook, GridConfig, GridResult, AlertItem, AlertStatus, AlertKind } from '@/types'

const STORAGE_KEY = 'grid-trading-alerts-v1'

/** 状态机：只允许 待处理 -> 已确认 -> 已恢复 */
const STATUS_FLOW: AlertStatus[] = ['pending', 'acknowledged', 'recovered']
const STATUS_LABEL: Record<AlertStatus, string> = {
  pending: '待处理',
  acknowledged: '已确认',
  recovered: '已恢复'
}

function canTransit(from: AlertStatus, to: AlertStatus): boolean {
  return STATUS_FLOW.indexOf(to) === STATUS_FLOW.indexOf(from) + 1
}

function loadAlerts(): AlertItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const list = JSON.parse(raw)
    return Array.isArray(list) ? list as AlertItem[] : []
  } catch {
    return []
  }
}

/** 一个“事件段”对应的活动告警（内存态，不持久化；刷新后按当前行情/回测重建） */
interface Episode { activeId: number | null; suppressed: boolean }

export const useTradingStore = defineStore('trading', () => {
  const loading = ref(false)
  const ticks = ref<Tick[]>([])
  const orderBook = ref<OrderBook | null>(null)
  const gridResult = ref<GridResult | null>(null)
  const wsConnected = ref(false)
  const config = ref<GridConfig>({ lowerPrice: 95, upperPrice: 115, gridCount: 20, capitalPerGrid: 1000, initialCapital: 100000 })

  // ---- 告警处置 ----
  const alerts = ref<AlertItem[]>(loadAlerts())
  const breachUp = ref<boolean>(false)
  const breachDown = ref<boolean>(false)
  const lossEpisode = ref<Episode>({ activeId: null, suppressed: false })
  const breachEpisodes = ref<Record<'up' | 'down', Episode>>({
    up: { activeId: null, suppressed: false },
    down: { activeId: null, suppressed: false }
  })
  let nextId = alerts.value.reduce((m, a) => Math.max(m, a.id), 0) + 1

  // 刷新后按当前未恢复告警重建事件段记忆，避免同一段行情重复建告警
  function rebuildEpisodes() {
    const up: Episode = { activeId: null, suppressed: false }
    const down: Episode = { activeId: null, suppressed: false }
    const loss: Episode = { activeId: null, suppressed: false }
    for (const a of alerts.value) {
      if (a.status === 'recovered') continue
      if (a.kind === 'grid_loss') {
        if (loss.activeId === null) loss.activeId = a.id
        continue
      }
      const dir = a.title.includes('上限') ? up : down
      if (dir.activeId === null) dir.activeId = a.id
    }
    breachEpisodes.value = { up, down }
    lossEpisode.value = loss
  }
  rebuildEpisodes()

  // 持久化：状态与处置说明刷新后保留
  watch(alerts, (list) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  }, { deep: true })

  function pushAlert(kind: AlertKind, title: string, detail: string, triggerPrice?: number): AlertItem {
    const item: AlertItem = {
      id: nextId++,
      kind,
      title,
      detail,
      triggerPrice,
      createdAt: Date.now(),
      status: 'pending',
      note: ''
    }
    alerts.value.unshift(item)
    return item
  }

  /** 价格越界检测：持续越界只产生一条告警；回落后已确认的自动恢复，待处理保持不变 */
  function evaluatePriceBreaches() {
    const t = ticks.value[ticks.value.length - 1]
    if (!t) return
    const price = t.price
    const overUp = price > config.value.upperPrice
    const overDown = price < config.value.lowerPrice

    const run = (over: boolean, dir: 'up' | 'down', make: () => AlertItem) => {
      const ep = breachEpisodes.value[dir]
      if (over) {
        if (ep.activeId === null && !ep.suppressed) {
          ep.activeId = make().id
        }
      } else if (ep.activeId !== null || ep.suppressed) {
        // 事件段结束：仅已确认的自动恢复；待处理告警留待用户处置
        if (ep.activeId !== null) {
          const a = alerts.value.find(x => x.id === ep.activeId)
          if (a && a.status === 'acknowledged') autoRecover(a)
        }
        ep.activeId = null
        ep.suppressed = false
      }
    }

    run(overUp, 'up', () => pushAlert(
      'price_breach',
      '价格越界（突破上限）',
      `最新价 ${price.toFixed(2)} 高于网格上限 ${config.value.upperPrice.toFixed(2)}，注意追高风险`,
      price
    ))
    run(overDown, 'down', () => pushAlert(
      'price_breach',
      '价格越界（跌破下限）',
      `最新价 ${price.toFixed(2)} 低于网格下限 ${config.value.lowerPrice.toFixed(2)}，网格已停止接单`,
      price
    ))

    breachUp.value = overUp
    breachDown.value = overDown
  }

  /** 网格亏损检测：每次亏损回测产生一条；新的盈利回测使已确认亏损告警自动恢复 */
  function evaluateGridLoss() {
    const r = gridResult.value
    if (!r) return
    const ep = lossEpisode.value
    if (r.totalProfit < 0) {
      if (ep.activeId === null && !ep.suppressed) {
        ep.activeId = pushAlert(
          'grid_loss',
          '网格亏损告警',
          `本次回测总盈亏 ¥${r.totalProfit.toFixed(2)}（收益率 ${r.returnRate.toFixed(2)}%，最大回撤 ${r.maxDrawdown.toFixed(2)}%），请检查网格参数`,
        ).id
      }
    } else if (ep.activeId !== null || ep.suppressed) {
      if (ep.activeId !== null) {
        const a = alerts.value.find(x => x.id === ep.activeId)
        if (a && a.status === 'acknowledged') autoRecover(a)
      }
      ep.activeId = null
      ep.suppressed = false
    }
  }

  function autoRecover(a: AlertItem) {
    doRecover(a, 'auto')
  }

  function doRecover(a: AlertItem, reason: 'auto' | 'manual') {
    a.status = 'recovered'
    a.recoveredAt = Date.now()
    a.recoverReason = reason
  }

  /**
   * 确认告警：必须填写处置说明。
   * 状态不能跳变；重复确认只生效一次并提示当前状态。
   * 返回 ok=false 时 message 为当前状态提示。
   */
  function acknowledgeAlert(id: number, note: string): { ok: boolean; message: string } {
    const a = alerts.value.find(x => x.id === id)
    if (!a) return { ok: false, message: '告警不存在，可能已被清理' }
    if (a.status !== 'pending') {
      return { ok: false, message: `该告警当前状态为「${STATUS_LABEL[a.status]}」，无需重复确认` }
    }
    const trimmed = note.trim()
    if (!trimmed) return { ok: false, message: '请填写处置说明后再确认' }
    a.status = 'acknowledged'
    a.note = trimmed
    a.acknowledgedAt = Date.now()
    // 确认时风险条件已解除（价格已回区间 / 已出现盈利回测）：直接自动恢复，不跳变
    if (!conditionStillActive(a)) autoRecover(a)
    return { ok: true, message: '已确认' }
  }

  /** 手动恢复：仅“已确认”可恢复；待处理必须先确认，已恢复不能重复恢复 */
  function recoverAlert(id: number): { ok: boolean; message: string } {
    const a = alerts.value.find(x => x.id === id)
    if (!a) return { ok: false, message: '告警不存在，可能已被清理' }
    if (a.status === 'pending') return { ok: false, message: '请先确认并填写处置说明，再标记恢复' }
    if (a.status === 'recovered') return { ok: false, message: '该告警已是「已恢复」状态' }
    if (!canTransit(a.status, 'recovered')) return { ok: false, message: `状态不能从「${STATUS_LABEL[a.status]}」跳变为「已恢复」` }
    doRecover(a, 'manual')
    closeEpisodeOf(a)
    return { ok: true, message: '已恢复，告警已归档到历史记录' }
  }

  /** 告警对应的风险条件目前是否仍然存在 */
  function conditionStillActive(a: AlertItem): boolean {
    if (a.kind === 'grid_loss') return (gridResult.value?.totalProfit ?? 0) < 0
    return a.title.includes('上限') ? breachUp.value : breachDown.value
  }

  /** 手动恢复后关闭对应事件段：风险仍在持续时抑制再次告警，直到风险解除后重新发生 */
  function closeEpisodeOf(a: AlertItem) {
    const stillActive = conditionStillActive(a)
    if (a.kind === 'grid_loss') {
      if (lossEpisode.value.activeId === a.id) lossEpisode.value.activeId = null
      lossEpisode.value.suppressed = stillActive
      return
    }
    const dir = a.title.includes('上限') ? 'up' : 'down'
    if (breachEpisodes.value[dir].activeId === a.id) breachEpisodes.value[dir].activeId = null
    breachEpisodes.value[dir].suppressed = stillActive
  }

  // 每条 WS 消息都会整体替换 ticks；网格上下限调整时也需重新判定
  watch([ticks, () => config.value.lowerPrice, () => config.value.upperPrice],
    () => evaluatePriceBreaches())
  watch(gridResult, () => evaluateGridLoss())

  let ws: WebSocket | null = null
  function connectWS() {
    ws = new WebSocket(`ws://${location.hostname}:8000/ws`)
    ws.onopen = () => { wsConnected.value = true }
    ws.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data)
        if (d.ticks) ticks.value = d.ticks.slice(-60)
        if (d.orderBook) orderBook.value = d.orderBook
      } catch {}
    }
    ws.onclose = () => { wsConnected.value = false }
  }

  async function runBacktest() {
    loading.value = true
    try { const { data } = await axios.post('/api/backtest', config.value) ; gridResult.value = data }
    finally { loading.value = false }
  }

  function disconnectWS() { ws?.close(); ws = null; wsConnected.value = false }

  return {
    loading, ticks, orderBook, gridResult, wsConnected, config,
    alerts, connectWS, runBacktest, disconnectWS,
    acknowledgeAlert, recoverAlert
  }
})
