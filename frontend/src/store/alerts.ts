import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import type { AlertItem, AlertStatus, AlertType, GridConfig, Tick } from '@/types'

const STORAGE_KEY = 'grid-engine:alerts:v1'

// 网格亏损告警阈值：净亏损（浮动+已实现）占累计投入资金的比例，触发与恢复带回滞防抖
const LOSS_TRIGGER_RATIO = 0.02
const LOSS_CLEAR_RATIO = 0.005

interface GridPosition { index: number; price: number; qty: number }
interface SimSnapshot {
  signature: string
  positions: GridPosition[]
  realizedPnl: number
  totalDeployed: number   // 累计投入网格资金（作为亏损率分母，避免持仓减少后比例失真）
  lossActive: boolean
}

export const STATUS_LABEL: Record<AlertStatus, string> = {
  PENDING: '待处理',
  ACKED: '已确认',
  RECOVERED: '已恢复',
}
export const TYPE_LABEL: Record<AlertType, string> = {
  PRICE_BREACH: '价格越界',
  GRID_LOSS: '网格亏损',
}

function nowText(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
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

export const useAlertStore = defineStore('alerts', () => {
  const alerts = ref<AlertItem[]>(loadAlerts())

  // ---- 持久化：刷新后状态与处置说明保留（同步写入，避免刷新瞬间丢失） ----
  watch(alerts, (list) => {
    try {
      // 历史保留全部已恢复告警；仅在条目过多时裁剪最老的已恢复记录（列表按时间倒序）
      const recovered = list.filter(a => a.status === 'RECOVERED')
      let trimmed = list
      if (recovered.length > 200) {
        const dropIds = new Set(recovered.slice(200).map(a => a.id))
        trimmed = list.filter(a => !dropIds.has(a.id))
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed))
    } catch { /* 存储不可用时不影响内存状态 */ }
  }, { deep: true, flush: 'sync' })

  function openAlert(type: AlertType, detailKey: string): AlertItem | undefined {
    return alerts.value.find(a => a.type === type && a.detail.includes(detailKey) && a.status !== 'RECOVERED')
  }

  function raise(type: AlertType, title: string, detail: string, price: number) {
    const id = alerts.value.reduce((m, a) => Math.max(m, a.id), 0) + 1
    alerts.value.unshift({
      id, type, title, detail, price: Math.round(price * 100) / 100,
      time: nowText(), status: 'PENDING', active: true,
      note: '', ackTime: null, recoverTime: null,
    })
  }

  function markRaised(a: AlertItem, price: number) {
    if (!a.active) a.active = true
    a.price = Math.round(price * 100) / 100
  }

  function recover(a: AlertItem) {
    a.active = false
    a.status = 'RECOVERED'
    a.recoverTime = nowText()
  }

  function clearCondition(a: AlertItem, price: number) {
    if (a.status === 'ACKED' && a.active) {
      // 已确认且条件消除 -> 自动流转到已恢复
      recover(a)
    } else if (a.active) {
      a.active = false
    }
  }

  /**
   * 确认告警：仅 待处理 -> 已确认，重复确认只生效一次并提示当前状态。
   * 若确认时触发条件已经消除，则确认后立即恢复（状态仍依次流转，不跳变）。
   */
  function acknowledge(id: number, note: string): { ok: boolean; message: string } {
    const a = alerts.value.find(x => x.id === id)
    if (!a) return { ok: false, message: '告警不存在，可能已被清理' }
    const trimmed = note.trim()
    if (!trimmed) return { ok: false, message: '请填写处置说明后再确认' }
    if (a.status === 'PENDING') {
      a.status = 'ACKED'
      a.note = trimmed
      a.ackTime = nowText()
      if (!a.active) {
        recover(a)
        return { ok: true, message: '已确认；触发条件已消除，告警自动恢复' }
      }
      return { ok: true, message: '已确认，请持续跟进处置' }
    }
    if (a.status === 'ACKED') {
      return { ok: false, message: `该告警已是「已确认」状态，无需重复确认（确认时间 ${a.ackTime ?? '-'}）` }
    }
    return { ok: false, message: `该告警已恢复（恢复时间 ${a.recoverTime ?? '-'}），不能再次确认` }
  }

  /** 手动恢复：仅 已确认 -> 已恢复，且要求触发条件已经消除，不允许跳变 */
  function markRecovered(id: number): { ok: boolean; message: string } {
    const a = alerts.value.find(x => x.id === id)
    if (!a) return { ok: false, message: '告警不存在，可能已被清理' }
    if (a.status === 'PENDING') return { ok: false, message: '待处理告警需先确认并填写处置说明，不能直接恢复' }
    if (a.status === 'RECOVERED') return { ok: false, message: '该告警已处于恢复状态' }
    if (a.active) return { ok: false, message: '触发条件仍未消除，暂不能恢复' }
    recover(a)
    return { ok: true, message: '告警已恢复并归档到历史记录' }
  }

  // ---- 实时网格模拟：用于网格亏损告警 ----
  const SIM_KEY = 'grid-engine:grid-sim:v2'
  function loadSim(): SimSnapshot | null {
    try {
      const raw = localStorage.getItem(SIM_KEY)
      return raw ? JSON.parse(raw) as SimSnapshot : null
    } catch { return null }
  }
  let sim: SimSnapshot = loadSim() ?? { signature: '', positions: [], realizedPnl: 0, totalDeployed: 0, lossActive: false }
  function saveSim() { try { localStorage.setItem(SIM_KEY, JSON.stringify(sim)) } catch {} }

  function resetSim(config: GridConfig) {
    sim = { signature: configSignature(config), positions: [], realizedPnl: 0, totalDeployed: 0, lossActive: false }
    saveSim()
  }
  function configSignature(c: GridConfig) {
    return `${c.lowerPrice}|${c.upperPrice}|${c.gridCount}|${c.capitalPerGrid}`
  }

  function ingestTick(tick: Tick, config: GridConfig) {
    const price = tick.price

    // ---- 价格越界 ----
    const upper = openAlert('PRICE_BREACH', '上限')
    const lower = openAlert('PRICE_BREACH', '下限')
    if (price > config.upperPrice) {
      if (upper) markRaised(upper, price)
      else raise('PRICE_BREACH', '价格越界 · 突破上限', `现价已突破网格上限 ¥${config.upperPrice}`, price)
    } else if (upper) {
      clearCondition(upper, price)
    }
    if (price < config.lowerPrice) {
      if (lower) markRaised(lower, price)
      else raise('PRICE_BREACH', '价格越界 · 跌破下限', `现价已跌破网格下限 ¥${config.lowerPrice}`, price)
    } else if (lower) {
      clearCondition(lower, price)
    }

    // ---- 网格模拟 ----
    if (sim.signature !== configSignature(config)) resetSim(config)
    const step = (config.upperPrice - config.lowerPrice) / config.gridCount
    const gridPrices: number[] = []
    for (let i = 0; i <= config.gridCount; i++) gridPrices.push(config.lowerPrice + i * step)

    for (let i = 0; i < gridPrices.length; i++) {
      const gp = gridPrices[i]
      const idx = sim.positions.findIndex(p => p.index === i)
      // 下穿网格线：买入
      if (price <= gp && idx === -1) {
        sim.positions.push({ index: i, price: gp, qty: config.capitalPerGrid / gp })
        sim.totalDeployed += config.capitalPerGrid
      }
      // 反弹半格：止盈卖出
      if (price >= gp + step * 0.5 && idx !== -1) {
        const pos = sim.positions[idx]
        sim.realizedPnl += pos.qty * (step * 0.5)
        sim.positions.splice(idx, 1)
      }
    }

    const floatingPnl = sim.positions.reduce((s, p) => s + (price - p.price) * p.qty, 0)
    const netPnl = floatingPnl + sim.realizedPnl
    const lossRatio = sim.totalDeployed > 0 ? Math.max(0, -netPnl) / sim.totalDeployed : 0

    const lossAlert = openAlert('GRID_LOSS', '网格持仓浮亏')
    if (!sim.lossActive && lossRatio >= LOSS_TRIGGER_RATIO) {
      sim.lossActive = true
      if (lossAlert) lossAlert.active = true
      else {
        raise(
          'GRID_LOSS',
          '网格亏损 · 浮亏超限',
          `网格持仓浮亏 ${(lossRatio * 100).toFixed(1)}%，超过 ${(LOSS_TRIGGER_RATIO * 100).toFixed(0)}% 阈值`,
          price,
        )
      }
    } else if (sim.lossActive && lossRatio <= LOSS_CLEAR_RATIO) {
      sim.lossActive = false
      if (lossAlert) clearCondition(lossAlert, price)
    } else if (lossAlert && sim.lossActive) {
      markRaised(lossAlert, price)
    }
    saveSim()
  }

  // ---- 列表与筛选 ----
  const filter = ref<AlertStatus | 'ALL'>('ALL')
  const filteredAlerts = computed(() =>
    filter.value === 'ALL' ? alerts.value : alerts.value.filter(a => a.status === filter.value),
  )
  const pendingCount = computed(() => alerts.value.filter(a => a.status === 'PENDING').length)
  const ackedCount = computed(() => alerts.value.filter(a => a.status === 'ACKED').length)
  const recoveredCount = computed(() => alerts.value.filter(a => a.status === 'RECOVERED').length)

  return {
    alerts, filteredAlerts, filter,
    pendingCount, ackedCount, recoveredCount,
    ingestTick, acknowledge, markRecovered,
  }
})
