import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readCache, writeCache, removeCache, fetchWithOfflineCache } from './offlineStore'

function setOnline(online: boolean) {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(online)
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('readCache / writeCache', () => {
  it('speichert Daten mit Zeitstempel und liest sie wieder', () => {
    writeCache('k', { a: 1 }, 1234)
    expect(readCache('k')).toEqual({ data: { a: 1 }, savedAt: 1234 })
  })

  it('liefert null für fehlende oder kaputte Einträge', () => {
    expect(readCache('fehlt')).toBeNull()
    localStorage.setItem('offline:v1:kaputt', '{nope')
    expect(readCache('kaputt')).toBeNull()
  })

  it('removeCache entfernt den Eintrag', () => {
    writeCache('k', 1)
    removeCache('k')
    expect(readCache('k')).toBeNull()
  })
})

describe('fetchWithOfflineCache', () => {
  it('lädt online frisch und legt einen Snapshot an', async () => {
    setOnline(true)
    const result = await fetchWithOfflineCache('k', async () => 'frisch')
    expect(result).toMatchObject({ data: 'frisch', fromCache: false })
    expect(readCache('k')?.data).toBe('frisch')
  })

  it('fällt bei Fehler auf den Snapshot zurück', async () => {
    setOnline(true)
    writeCache('k', 'alt', 99)
    const result = await fetchWithOfflineCache('k', async () => { throw new Error('boom') })
    expect(result).toEqual({ data: 'alt', fromCache: true, savedAt: 99 })
  })

  it('wirft den Originalfehler ohne Snapshot', async () => {
    setOnline(true)
    await expect(fetchWithOfflineCache('k', async () => { throw new Error('boom') })).rejects.toThrow('boom')
  })

  it('ruft offline gar nicht erst das Netz auf', async () => {
    setOnline(false)
    writeCache('k', 'alt', 99)
    const fetcher = vi.fn()
    const result = await fetchWithOfflineCache('k', fetcher)
    expect(fetcher).not.toHaveBeenCalled()
    expect(result.data).toBe('alt')
  })
})
