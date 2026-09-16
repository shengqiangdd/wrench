/**
 * terminal-reconnect —— 断线自动重连的节奏与文案（batch 2b ②）
 */
import { describe, expect, it } from 'vitest'
import {
  RECONNECT_DELAYS_SECONDS,
  describeDisconnect,
  formatReconnectCountdown,
  formatReconnectGaveUp,
  maxReconnectAttempts,
  normalizeDisconnectReason,
  reconnectDelaySeconds,
  shouldAutoReconnect,
} from '../../utils/terminal-reconnect'

describe('normalizeDisconnectReason', () => {
  it('认识后端给的三个 reason', () => {
    expect(normalizeDisconnectReason('exit')).toBe('exit')
    expect(normalizeDisconnectReason('closed')).toBe('closed')
    expect(normalizeDisconnectReason('client')).toBe('client')
  })

  it('老后端 / 垃圾值 → unknown（当成"掉线"，宁可重连）', () => {
    expect(normalizeDisconnectReason(undefined)).toBe('unknown')
    expect(normalizeDisconnectReason(null)).toBe('unknown')
    expect(normalizeDisconnectReason('whatever')).toBe('unknown')
    expect(normalizeDisconnectReason(7)).toBe('unknown')
  })
})

describe('shouldAutoReconnect', () => {
  it('用户自己敲的 exit 不自动重开（否则刚退出又塞一个新 shell）', () => {
    expect(shouldAutoReconnect('exit')).toBe(false)
  })

  it('WebSocket 先断 / 协议错误 都不自动重连', () => {
    expect(shouldAutoReconnect('client')).toBe(false)
    expect(shouldAutoReconnect('error')).toBe(false)
  })

  it('通道掉了没退出码 / 原因不明 → 自动重连', () => {
    expect(shouldAutoReconnect('closed')).toBe(true)
    expect(shouldAutoReconnect('unknown')).toBe(true)
  })
})

describe('退避节奏', () => {
  it('第 1..N 次等待与表一致，前快后慢', () => {
    RECONNECT_DELAYS_SECONDS.forEach((expected, i) => {
      expect(reconnectDelaySeconds(i + 1)).toBe(expected)
    })
    expect(reconnectDelaySeconds(1)).toBeLessThan(reconnectDelaySeconds(4))
  })

  it('超出表长取最后一档（封顶 15s）', () => {
    const last = RECONNECT_DELAYS_SECONDS[RECONNECT_DELAYS_SECONDS.length - 1]
    expect(reconnectDelaySeconds(99)).toBe(last)
    expect(reconnectDelaySeconds(maxReconnectAttempts() + 3)).toBe(last)
  })

  it('非法输入不返回 NaN（计时器最怕 NaN）', () => {
    expect(reconnectDelaySeconds(0)).toBe(RECONNECT_DELAYS_SECONDS[0])
    expect(reconnectDelaySeconds(-1)).toBe(RECONNECT_DELAYS_SECONDS[0])
    expect(reconnectDelaySeconds(NaN)).toBe(RECONNECT_DELAYS_SECONDS[0])
  })
})

describe('文案', () => {
  it('倒计时文案带原因与第几次', () => {
    expect(formatReconnectCountdown(2, 3, '连接中断')).toBe(
      `连接中断 · 3 秒后自动重连（第 2/${maxReconnectAttempts()} 次）`,
    )
  })

  it('放弃文案说清"停下来了，可以手动"', () => {
    const text = formatReconnectGaveUp()
    expect(text).toContain('已停止')
    expect(text).toContain('手动')
  })

  it('drop 原因的人话', () => {
    expect(describeDisconnect('exit')).toContain('退出')
    expect(describeDisconnect('client')).toContain('网络')
    expect(describeDisconnect('error')).toContain('出错')
    expect(describeDisconnect('closed')).toBe('连接中断')
  })
})

describe('倒计时文案不套娃（回归）', () => {
  it('原因与通用说法同义时不重复', () => {
    expect(formatReconnectCountdown(1, 2)).toBe('连接中断 · 2 秒后自动重连（第 1/8 次）')
    expect(formatReconnectCountdown(1, 2, '连接中断')).not.toContain('（连接中断）')
  })

  it('更具体的原因不套娃，且保留那层信息', () => {
    const text = formatReconnectCountdown(1, 2, '网络连接中断')
    expect(text).toContain('网络')
    // 括号里是「第 1/8 次」，不该再出现一个「（网络连接中断）」的嵌套
    expect(text).not.toContain('（网络连接中断）')
    expect(text).toBe('网络连接中断 · 2 秒后自动重连（第 1/8 次）')
  })

  it('不同措辞的原因照样带在括号里', () => {
    expect(formatReconnectCountdown(3, 12, '远端 shell 已退出')).toBe(
      '连接中断（远端 shell 已退出） · 12 秒后自动重连（第 3/8 次）',
    )
  })
})
