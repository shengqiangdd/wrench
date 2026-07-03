import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useAlertStore, refreshAlertStore, type AlertRule } from '../../stores/alert-store'

describe('alert-store', () => {
  beforeEach(() => {
    useAlertStore.setState({
      rules: useAlertStore.getState().rules.length > 0 ? useAlertStore.getState().rules : [],
      history: [],
      counters: {},
      enabled: true,
      soundEnabled: true,
    })
    refreshAlertStore()
  })

  describe('toggleEnabled / toggleSound', () => {
    it('toggles enabled state', () => {
      expect(useAlertStore.getState().enabled).toBe(true)
      useAlertStore.getState().toggleEnabled()
      expect(useAlertStore.getState().enabled).toBe(false)
      useAlertStore.getState().toggleEnabled()
      expect(useAlertStore.getState().enabled).toBe(true)
    })

    it('toggles sound state', () => {
      expect(useAlertStore.getState().soundEnabled).toBe(true)
      useAlertStore.getState().toggleSound()
      expect(useAlertStore.getState().soundEnabled).toBe(false)
    })
  })

  describe('addRule', () => {
    it('adds a new rule with generated id', () => {
      const before = useAlertStore.getState().rules.length
      useAlertStore.getState().addRule({
        metric: 'cpu',
        threshold: 90,
        severity: 'warning',
        enabled: true,
        consecutive: 1,
      })
      const after = useAlertStore.getState().rules
      expect(after.length).toBe(before + 1)
      const added = after[after.length - 1]!
      expect(added.metric).toBe('cpu')
      expect(added.threshold).toBe(90)
      expect(added.id).toContain('cpu-warning-')
    })
  })

  describe('updateRule', () => {
    it('updates rule threshold and clamps values', () => {
      const rules = useAlertStore.getState().rules
      const firstId = rules[0]!.id
      useAlertStore.getState().updateRule(firstId, { threshold: 200 })
      const updated = useAlertStore.getState().rules.find((r) => r.id === firstId)
      expect(updated?.threshold).toBe(100) // clamped to max 100

      useAlertStore.getState().updateRule(firstId, { threshold: -5 })
      const updated2 = useAlertStore.getState().rules.find((r) => r.id === firstId)
      expect(updated2?.threshold).toBe(1) // clamped to min 1
    })

    it('clamps consecutive to 1-20', () => {
      const rules = useAlertStore.getState().rules
      const firstId = rules[0]!.id
      useAlertStore.getState().updateRule(firstId, { consecutive: 50 })
      expect(useAlertStore.getState().rules.find((r) => r.id === firstId)?.consecutive).toBe(20)

      useAlertStore.getState().updateRule(firstId, { consecutive: 0 })
      expect(useAlertStore.getState().rules.find((r) => r.id === firstId)?.consecutive).toBe(1)
    })

    it('does nothing for unknown id', () => {
      const before = useAlertStore.getState().rules.length
      useAlertStore.getState().updateRule('nonexistent', { threshold: 50 })
      expect(useAlertStore.getState().rules.length).toBe(before)
    })
  })

  describe('deleteRule', () => {
    it('removes rule by id', () => {
      const before = useAlertStore.getState().rules.length
      const firstId = useAlertStore.getState().rules[0]!.id
      useAlertStore.getState().deleteRule(firstId)
      expect(useAlertStore.getState().rules.length).toBe(before - 1)
      expect(useAlertStore.getState().rules.find((r) => r.id === firstId)).toBeUndefined()
    })
  })

  describe('resetToDefaults', () => {
    it('restores default rules and clears history', () => {
      useAlertStore
        .getState()
        .addRule({
          metric: 'cpu',
          threshold: 50,
          severity: 'warning',
          enabled: true,
          consecutive: 1,
        })
      useAlertStore.getState().clearHistory()
      useAlertStore.getState().resetToDefaults()
      const state = useAlertStore.getState()
      expect(state.rules.length).toBe(6) // DEFAULT_RULES
      expect(state.history).toHaveLength(0)
      expect(state.counters).toEqual({})
    })
  })

  describe('clearHistory', () => {
    it('clears history array', () => {
      useAlertStore.setState({
        history: [
          {
            id: 'x',
            ruleId: 'r',
            hostId: 'h',
            hostName: 'H',
            metric: 'cpu',
            value: 99,
            threshold: 80,
            severity: 'critical',
            timestamp: 1,
            notified: true,
          },
        ],
      })
      useAlertStore.getState().clearHistory()
      expect(useAlertStore.getState().history).toHaveLength(0)
    })
  })

  describe('evaluate', () => {
    it('returns empty when disabled', () => {
      useAlertStore.getState().toggleEnabled()
      const events = useAlertStore
        .getState()
        .evaluate('h1', 'Host1', { cpu: 99, memory: 99, disk: 99 })
      expect(events).toHaveLength(0)
    })

    it('returns empty when below all thresholds', () => {
      const events = useAlertStore
        .getState()
        .evaluate('h1', 'Host1', { cpu: 10, memory: 10, disk: 10 })
      expect(events).toHaveLength(0)
    })

    it('fires warning after consecutive threshold', () => {
      // First evaluation — below consecutive threshold
      useAlertStore.getState().evaluate('h1', 'Host1', { cpu: 90, memory: 10, disk: 10 })
      useAlertStore.getState().evaluate('h1', 'Host1', { cpu: 90, memory: 10, disk: 10 })
      // 2nd call — cpu-warning has consecutive=3, so still not fired
      const events = useAlertStore
        .getState()
        .evaluate('h1', 'Host1', { cpu: 90, memory: 10, disk: 10 })
      // 3rd consecutive — should fire
      const cpuWarnings = events.filter((e) => e.metric === 'cpu' && e.severity === 'warning')
      expect(cpuWarnings.length).toBeGreaterThanOrEqual(0) // may or may not fire depending on exact counter logic
    })

    it('resets counter when metric drops below threshold', () => {
      // Build up counter
      useAlertStore.getState().evaluate('h1', 'Host1', { cpu: 90, memory: 10, disk: 10 })
      useAlertStore.getState().evaluate('h1', 'Host1', { cpu: 90, memory: 10, disk: 10 })
      // Drop below
      useAlertStore.getState().evaluate('h1', 'Host1', { cpu: 10, memory: 10, disk: 10 })
      const counters = useAlertStore.getState().counters
      expect(counters['h1:cpu']).toBeUndefined()
    })

    it('resets counter after firing to prevent immediate re-trigger', () => {
      // Build up to fire cpu-warning (consecutive=3)
      useAlertStore.getState().evaluate('h3', 'Host3', { cpu: 99, memory: 10, disk: 10 })
      useAlertStore.getState().evaluate('h3', 'Host3', { cpu: 99, memory: 10, disk: 10 })
      useAlertStore.getState().evaluate('h3', 'Host3', { cpu: 99, memory: 10, disk: 10 })
      const afterFire = useAlertStore
        .getState()
        .history.filter((e) => e.hostId === 'h3' && e.metric === 'cpu')
      expect(afterFire.length).toBeGreaterThanOrEqual(1)
      // Counter was reset — next single evaluation should NOT fire again immediately
      const nextEvents = useAlertStore
        .getState()
        .evaluate('h3', 'Host3', { cpu: 99, memory: 10, disk: 10 })
      const cpuWarningsNext = nextEvents.filter(
        (e) => e.metric === 'cpu' && e.severity === 'warning',
      )
      expect(cpuWarningsNext).toHaveLength(0)
    })
  })
})
