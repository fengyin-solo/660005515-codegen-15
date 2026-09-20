<template>
  <div class="panel alert-panel">
    <div class="alert-head">
      <h4>🚨 告警中心
        <el-badge v-if="alertStore.pendingCount" :value="alertStore.pendingCount" :max="99" class="head-badge" type="danger" />
      </h4>
      <div class="filters">
        <button
          v-for="f in filters" :key="f.value"
          class="filter-btn" :class="{ on: alertStore.filter === f.value }"
          @click="alertStore.filter = f.value"
        >
          {{ f.label }}<span class="cnt">{{ f.count }}</span>
        </button>
      </div>
    </div>

    <div v-if="alertStore.filteredAlerts.length === 0" class="empty">
      {{ alertStore.filter === 'ALL' ? '暂无告警，系统运行正常' : '该状态下暂无告警' }}
    </div>

    <div v-else class="alert-list">
      <div v-for="a in alertStore.filteredAlerts" :key="a.id" class="alert-row" :class="[a.type, a.status.toLowerCase()]">
        <div class="row-main">
          <div class="row-top">
            <span class="type-tag" :class="a.type">{{ typeLabel(a.type) }}</span>
            <span class="status-tag" :class="a.status.toLowerCase()">{{ statusLabel(a.status) }}</span>
            <span v-if="a.active && a.status !== 'RECOVERED'" class="pulse-dot" title="触发条件仍存在"></span>
            <span class="title">{{ a.title }}</span>
            <span class="price">@¥{{ a.price.toFixed(2) }}</span>
            <span class="time">{{ a.time }}</span>
          </div>
          <div class="detail">{{ a.detail }}</div>
          <div class="handled" v-if="a.note">
            <span class="h-label">处置说明</span>
            <span class="h-note">{{ a.note }}</span>
            <span class="h-time">（{{ a.ackTime }} 确认）</span>
          </div>
          <div class="recovered-line" v-if="a.status === 'RECOVERED'">
            ✓ 已于 {{ a.recoverTime }} 恢复，可在历史记录中查询
          </div>
        </div>
        <div class="row-actions">
          <el-button
            v-if="a.status === 'PENDING'"
            type="warning" size="small"
            @click="openAck(a.id)"
          >确认处置</el-button>
          <el-button
            v-if="a.status === 'ACKED'"
            type="success" size="small"
            :disabled="a.active"
            :title="a.active ? '触发条件仍未消除' : ''"
            @click="doRecover(a.id)"
          >标记恢复</el-button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useAlertStore, STATUS_LABEL, TYPE_LABEL } from '../store/alerts'
import type { AlertStatus, AlertType } from '../types'

const alertStore = useAlertStore()
const statusLabel = (s: AlertStatus) => STATUS_LABEL[s]
const typeLabel = (t: AlertType) => TYPE_LABEL[t]

const filters = computed(() => [
  { label: '全部', value: 'ALL' as const, count: alertStore.alerts.length },
  { label: '待处理', value: 'PENDING' as const, count: alertStore.pendingCount },
  { label: '已确认', value: 'ACKED' as const, count: alertStore.ackedCount },
  { label: '已恢复', value: 'RECOVERED' as const, count: alertStore.recoveredCount },
])

async function openAck(id: number) {
  try {
    const { value } = await ElMessageBox.prompt('请填写处置说明（必填），确认后告警进入「已确认」状态', '确认告警', {
      confirmButtonText: '确认',
      cancelButtonText: '取消',
      inputType: 'textarea',
      inputPlaceholder: '例如：已通知交易员核查仓位，手动减仓 20%',
      inputValidator: (v: string) => (v && v.trim().length > 0) || '处置说明不能为空',
    })
    const r = alertStore.acknowledge(id, value)
    r.ok ? ElMessage.success(r.message) : ElMessage.warning(r.message)
  } catch { /* 用户取消 */ }
}

function doRecover(id: number) {
  const r = alertStore.markRecovered(id)
  r.ok ? ElMessage.success(r.message) : ElMessage.warning(r.message)
}
</script>

<style scoped>
.panel{background:#0f1535;border-radius:8px;padding:12px;border:1px solid #1e2a5a}
.alert-panel h4{color:#4fc3f7;font-size:13px;display:flex;align-items:center;gap:8px}
.head-badge{margin-left:2px}
.alert-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:8px}
.filters{display:flex;gap:4px}
.filter-btn{display:flex;align-items:center;gap:5px;background:#0a0e27;border:1px solid #1e2a5a;color:#94a3b8;
  font-size:11px;padding:3px 10px;border-radius:12px;cursor:pointer;transition:all .15s}
.filter-btn:hover{border-color:#4fc3f7;color:#e0e0e0}
.filter-btn.on{background:#13304d;border-color:#4fc3f7;color:#4fc3f7}
.filter-btn .cnt{background:#1e2a5a;border-radius:8px;padding:0 6px;font-size:10px;line-height:14px}
.filter-btn.on .cnt{background:#1d4e75;color:#cfeaff}
.empty{padding:24px;text-align:center;color:#64748b;font-size:12px}
.alert-list{display:flex;flex-direction:column;gap:6px;max-height:300px;overflow-y:auto}
.alert-row{display:flex;justify-content:space-between;align-items:center;gap:10px;
  background:#0a0e27;border-radius:6px;padding:8px 10px;border-left:3px solid #64748b}
.alert-row.price_breach{border-left-color:#f59e0b}
.alert-row.grid_loss{border-left-color:#ef4444}
.alert-row.recovered{opacity:.62}
.row-top{display:flex;align-items:center;gap:8px;font-size:11px;margin-bottom:3px;flex-wrap:wrap}
.type-tag{font-size:10px;padding:1px 7px;border-radius:3px;font-weight:600}
.type-tag.price_breach{background:#f59e0b22;color:#fbbf24}
.type-tag.grid_loss{background:#ef444422;color:#f87171}
.status-tag{font-size:10px;padding:1px 7px;border-radius:3px}
.status-tag.pending{background:#ef444422;color:#f87171}
.status-tag.acked{background:#3b82f622;color:#60a5fa}
.status-tag.recovered{background:#22c55e22;color:#4ade80}
.pulse-dot{width:7px;height:7px;border-radius:50%;background:#ef4444;animation:pulse 1.2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.25}}
.title{color:#e0e0e0;font-weight:600}
.price{color:#94a3b8;font-family:monospace}
.time{color:#64748b;margin-left:auto}
.detail{font-size:11px;color:#94a3b8}
.handled{font-size:11px;margin-top:4px;color:#cbd5e1;background:#13304d55;border-radius:4px;padding:3px 7px}
.h-label{color:#60a5fa;margin-right:6px}
.h-time{color:#64748b}
.recovered-line{font-size:11px;color:#4ade80;margin-top:4px}
.row-actions{flex-shrink:0;display:flex;gap:6px}
</style>
