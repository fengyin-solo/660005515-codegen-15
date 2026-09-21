<template>
  <div class="panel alert-panel">
    <h4>
      🚨 告警处置
      <span class="pending-chip" v-if="pendingCount > 0">{{ pendingCount }}</span>
    </h4>

    <div class="filter-bar">
      <button
        v-for="f in filters"
        :key="f.value"
        class="filter-btn"
        :class="{ active: filter === f.value }"
        @click="filter = f.value"
      >
        {{ f.label }}
        <span class="f-count">{{ countOf(f.value) }}</span>
      </button>
    </div>

    <div v-if="filteredAlerts.length === 0" class="empty-tip">暂无{{ currentFilterLabel }}告警</div>

    <div class="alert-list">
      <div v-for="a in filteredAlerts" :key="a.id" class="alert-card" :class="a.status">
        <div class="alert-head">
          <span class="alert-kind">
            {{ a.kind === 'price_breach' ? '⛔ 价格越界' : '💸 网格亏损' }}
          </span>
          <span class="alert-status" :class="a.status">{{ statusText(a.status) }}</span>
        </div>
        <div class="alert-title">{{ a.title }}</div>
        <div class="alert-detail">{{ a.detail }}</div>
        <div class="alert-meta">
          <span>触发：{{ formatTime(a.createdAt) }}</span>
          <span v-if="a.acknowledgedAt">确认：{{ formatTime(a.acknowledgedAt) }}</span>
          <span v-if="a.recoveredAt">
            恢复：{{ formatTime(a.recoveredAt) }}（{{ a.recoverReason === 'manual' ? '手动' : '自动' }}）
          </span>
        </div>
        <div class="alert-note" v-if="a.note">
          <span class="note-label">处置说明：</span>{{ a.note }}
        </div>
        <div class="alert-actions" v-if="a.status !== 'recovered'">
          <el-button
            v-if="a.status === 'pending'"
            type="warning"
            size="small"
            @click="openConfirm(a.id)"
          >✓ 确认处置</el-button>
          <el-popconfirm
            v-else
            title="确认该告警已恢复？恢复后可在历史记录中查看"
            confirm-button-text="恢复"
            cancel-button-text="取消"
            @confirm="doRecover(a.id)"
          >
            <template #reference>
              <el-button type="success" size="small">↻ 标记恢复</el-button>
            </template>
          </el-popconfirm>
        </div>
      </div>
    </div>

    <el-dialog v-model="dialogVisible" title="确认告警处置" width="92%" :append-to-body="true">
      <div class="dlg-alert" v-if="targetAlert">
        <strong>{{ targetAlert.title }}</strong>
        <p>{{ targetAlert.detail }}</p>
      </div>
      <el-input
        v-model="noteInput"
        type="textarea"
        :rows="3"
        maxlength="200"
        show-word-limit
        placeholder="请填写处置说明（必填），例如：已下调网格上限 / 已暂停网格并减仓"
      />
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="warning" @click="doAck">提交确认</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useTradingStore } from '../store/trading'
import type { AlertItem, AlertStatus } from '../types'

const store = useTradingStore()

type FilterValue = AlertStatus | 'all'
const filter = ref<FilterValue>('pending')
const filters: { value: FilterValue; label: string }[] = [
  { value: 'pending', label: '待处理' },
  { value: 'acknowledged', label: '已确认' },
  { value: 'recovered', label: '历史（已恢复）' },
  { value: 'all', label: '全部' }
]

const statusText = (s: AlertStatus) => s === 'pending' ? '待处理' : s === 'acknowledged' ? '已确认' : '已恢复'

function countOf(v: FilterValue): number {
  return v === 'all' ? store.alerts.length : store.alerts.filter(a => a.status === v).length
}
const pendingCount = computed(() => countOf('pending'))

const filteredAlerts = computed<AlertItem[]>(() => {
  const list = filter.value === 'all' ? store.alerts : store.alerts.filter(a => a.status === filter.value)
  // 同状态内按触发时间倒序
  return [...list].sort((x, y) => y.createdAt - x.createdAt)
})
const currentFilterLabel = computed(() => filters.find(f => f.value === filter.value)?.label ?? '')

function formatTime(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

// ---- 确认弹窗 ----
const dialogVisible = ref(false)
const noteInput = ref('')
const targetId = ref<number | null>(null)
const targetAlert = computed(() => store.alerts.find(a => a.id === targetId.value) ?? null)

function openConfirm(id: number) {
  targetId.value = id
  noteInput.value = ''
  dialogVisible.value = true
}

function doAck() {
  if (targetId.value === null) return
  const r = store.acknowledgeAlert(targetId.value, noteInput.value)
  if (r.ok) {
    ElMessage.success(r.message)
    dialogVisible.value = false
  } else {
    // 重复确认 / 状态不符：只提示当前状态，不产生任何变更
    ElMessage.warning(r.message)
    if (targetAlert.value === null) dialogVisible.value = false
  }
}

function doRecover(id: number) {
  const r = store.recoverAlert(id)
  if (r.ok) ElMessage.success(r.message)
  else ElMessage.warning(r.message)
}
</script>

<style scoped>
.alert-panel{background:#0f1535;border-radius:8px;padding:12px;border:1px solid #1e2a5a}
.alert-panel h4{color:#4fc3f7;font-size:13px;margin-bottom:8px;display:flex;align-items:center;gap:6px}
.pending-chip{background:#ef4444;color:#fff;font-size:10px;line-height:1;padding:2px 6px;border-radius:9px}
.filter-bar{display:flex;gap:4px;margin-bottom:8px;flex-wrap:wrap}
.filter-btn{flex:1;min-width:64px;background:#0a0e27;border:1px solid #1e2a5a;color:#94a3b8;font-size:11px;
  padding:4px 6px;border-radius:4px;cursor:pointer;transition:all .15s;white-space:nowrap}
.filter-btn:hover{border-color:#4fc3f7;color:#e0e0e0}
.filter-btn.active{background:#4fc3f722;border-color:#4fc3f7;color:#4fc3f7}
.f-count{margin-left:3px;opacity:.8}
.empty-tip{font-size:12px;color:#64748b;text-align:center;padding:14px 0}
.alert-list{display:flex;flex-direction:column;gap:6px;max-height:340px;overflow-y:auto}
.alert-card{background:#0a0e27;border-radius:6px;padding:8px;border-left:3px solid #ef4444}
.alert-card.acknowledged{border-left-color:#f59e0b}
.alert-card.recovered{border-left-color:#22c55e;opacity:.78}
.alert-head{display:flex;justify-content:space-between;align-items:center}
.alert-kind{font-size:11px;color:#cbd5e1}
.alert-status{font-size:10px;padding:1px 7px;border-radius:8px;font-weight:600}
.alert-status.pending{background:#ef444422;color:#f87171}
.alert-status.acknowledged{background:#f59e0b22;color:#fbbf24}
.alert-status.recovered{background:#22c55e22;color:#4ade80}
.alert-title{font-size:12px;font-weight:600;color:#e0e0e0;margin:4px 0 2px}
.alert-detail{font-size:11px;color:#94a3b8;line-height:1.5}
.alert-meta{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:10px;color:#64748b;margin-top:5px}
.alert-note{margin-top:5px;font-size:11px;color:#7dd3fc;background:#4fc3f710;border-radius:4px;padding:4px 6px;line-height:1.5}
.note-label{color:#64748b}
.alert-actions{margin-top:7px;display:flex;gap:6px}
.dlg-alert{background:#0f1535;border-radius:6px;padding:8px 10px;margin-bottom:10px;font-size:13px;color:#e0e0e0}
.dlg-alert p{margin:4px 0 0;font-size:12px;color:#94a3b8}
</style>
