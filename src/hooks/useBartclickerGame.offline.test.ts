import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { writeGameSnapshot, readGameSnapshot } from '../lib/bartclickerOffline'
import type { BartclickerGameState } from '../types/bartclicker'

const rpc = vi.fn()
const single = vi.fn()

vi.mock('../context/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u1' } }),
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: () => ({ select: () => ({ eq: () => ({ single: () => single() }) }) }),
  },
}))

import { useBartclickerGame } from './useBartclickerGame'

function localState(total: number): BartclickerGameState {
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

let online = true
beforeEach(() => {
  localStorage.clear()
  rpc.mockReset().mockResolvedValue({ data: { success: true }, error: null })
  single.mockReset()
  online = true
  vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useBartclickerGame offline', () => {
  it('spielt offline mit dem lokalen Spielstand weiter, ohne den Server zu fragen', async () => {
    online = false
    writeGameSnapshot('u1', localState(4242), true)

    const { result } = renderHook(() => useBartclickerGame())

    await waitFor(() => expect(result.current.gameState.total_ever).toBeGreaterThanOrEqual(4242))
    expect(single).not.toHaveBeenCalled()

    // Klicken offline: Fortschritt landet lokal, kein Upload
    act(() => result.current.handleClick())
    await act(async () => { await result.current.saveGameState() })
    expect(rpc).not.toHaveBeenCalled()
    expect(readGameSnapshot('u1')).toMatchObject({ dirty: true })
    expect(readGameSnapshot('u1')!.state.total_ever).toBeGreaterThan(4242)
  })

  it('lädt offline erspielten Fortschritt hoch, wenn er neuer als der Server ist', async () => {
    writeGameSnapshot('u1', localState(9000), true)
    single.mockResolvedValue({
      data: { ...localState(0), id: 'row', energy: '5000', total_ever: '5000', last_updated: new Date().toISOString() },
      error: null,
    })

    const { result } = renderHook(() => useBartclickerGame())

    await waitFor(() => expect(result.current.gameState.total_ever).toBeGreaterThanOrEqual(9000))
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('save_bartclicker_state', expect.objectContaining({ p_total_ever: 9000 })))
    await waitFor(() => expect(readGameSnapshot('u1')?.dirty).toBe(false))
  })

  it('übernimmt den Server-Stand, wenn dort weitergespielt wurde', async () => {
    writeGameSnapshot('u1', localState(100), true)
    single.mockResolvedValue({
      data: { ...localState(0), id: 'row', energy: '7000', total_ever: '7000', last_updated: new Date().toISOString() },
      error: null,
    })

    const { result } = renderHook(() => useBartclickerGame())

    await waitFor(() => expect(result.current.gameState.total_ever).toBeGreaterThanOrEqual(7000))
    expect(readGameSnapshot('u1')).toMatchObject({ dirty: false, state: { total_ever: 7000 } })
  })
})
