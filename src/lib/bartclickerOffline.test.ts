import { describe, it, expect, beforeEach } from 'vitest'
import {
  readGameSnapshot,
  writeGameSnapshot,
  markGameSnapshotSynced,
  clearGameSnapshot,
  shouldPreferLocal,
} from './bartclickerOffline'
import type { BartclickerGameState } from '../types/bartclicker'

function state(total: number): BartclickerGameState {
  return {
    user_id: 'u1',
    energy: total,
    total_ever: total,
    rebirth_count: 0,
    rebirth_multiplier: 1,
    shop_items: [],
    active_buffs: [],
    active_debuffs: [],
    relics: [],
    offline_earning_upgrades: 0,
    auto_click_buyer_enabled: false,
    click_upgrade_buyer_enabled: false,
    click_upgrade_buyer_items: [],
    auto_click_buyer_unlocked: false,
    click_upgrade_buyer_unlocked: false,
  }
}

beforeEach(() => {
  localStorage.clear()
})

describe('Spielstand-Snapshot', () => {
  it('sichert und lädt den Spielstand pro User', () => {
    writeGameSnapshot('u1', state(500), true)
    expect(readGameSnapshot('u1')).toMatchObject({ dirty: true, state: { total_ever: 500 } })
    expect(readGameSnapshot('u2')).toBeNull()
    clearGameSnapshot('u1')
    expect(readGameSnapshot('u1')).toBeNull()
  })

  it('markiert nur den hochgeladenen Stand als synchronisiert', () => {
    const uploadedAt = writeGameSnapshot('u1', state(500), true)
    markGameSnapshotSynced('u1', uploadedAt)
    expect(readGameSnapshot('u1')?.dirty).toBe(false)
  })

  it('lässt einen neueren lokalen Stand dirty', () => {
    const uploadedAt = writeGameSnapshot('u1', state(500), true)
    // neuerer Stand, während der Upload lief
    writeGameSnapshot('u1', state(600), true)
    markGameSnapshotSynced('u1', uploadedAt - 1)
    expect(readGameSnapshot('u1')).toMatchObject({ dirty: true, state: { total_ever: 600 } })
  })
})

describe('shouldPreferLocal', () => {
  it('nimmt den Server, wenn kein lokaler Stand existiert', () => {
    expect(shouldPreferLocal(null, { total_ever: 10 })).toBe(false)
  })

  it('nimmt lokal, wenn der Server nicht erreichbar war', () => {
    expect(shouldPreferLocal({ dirty: false, state: { total_ever: 1 } }, null)).toBe(true)
  })

  it('nimmt offline erspielten Fortschritt, wenn er vor dem Server liegt', () => {
    expect(shouldPreferLocal({ dirty: true, state: { total_ever: 2000 } }, { total_ever: '1500' })).toBe(true)
  })

  it('nimmt den Server, wenn dort weitergespielt wurde', () => {
    expect(shouldPreferLocal({ dirty: true, state: { total_ever: 1000 } }, { total_ever: 5000 })).toBe(false)
  })

  it('nimmt den Server, wenn der lokale Stand bereits synchronisiert ist', () => {
    expect(shouldPreferLocal({ dirty: false, state: { total_ever: 9000 } }, { total_ever: 5000 })).toBe(false)
  })
})
