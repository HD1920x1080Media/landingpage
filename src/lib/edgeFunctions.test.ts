import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { buildEdgeFunctionUrl, fetchCalendarText, lookupTwitchUserId } from './edgeFunctions'

// Supabase-Env explizit leeren: die Fallback-Tests dürfen nicht davon abhängen,
// ob lokal eine .env mit VITE_SUPABASE_URL existiert.
beforeEach(() => {
  // Offline-Cache leeren, sonst liefert fetchCalendarText Snapshots früherer Tests
  localStorage.clear()
  vi.stubEnv('VITE_SUPABASE_URL', '')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('buildEdgeFunctionUrl', () => {
  it('baut die Function-URL mit Query-Parametern', () => {
    expect(
      buildEdgeFunctionUrl('https://xyz.supabase.co', 'calendar', { url: 'https://a.b/c.ics' }),
    ).toBe('https://xyz.supabase.co/functions/v1/calendar?url=https%3A%2F%2Fa.b%2Fc.ics')
  })

  it('entfernt abschließende Slashes der Supabase-URL', () => {
    expect(buildEdgeFunctionUrl('https://xyz.supabase.co/', 'twitch-user')).toBe(
      'https://xyz.supabase.co/functions/v1/twitch-user',
    )
  })

  it('liefert null ohne konfigurierte Supabase-URL', () => {
    expect(buildEdgeFunctionUrl(undefined, 'calendar')).toBeNull()
    expect(buildEdgeFunctionUrl('', 'calendar')).toBeNull()
  })
})

describe('fetchCalendarText (ohne Supabase-Env)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('fällt auf den statischen Pfad zurück und liefert dessen Inhalt', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('BEGIN:VCALENDAR', { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const text = await fetchCalendarText('https://export.kalender.digital/x.ics', '/api/calendar.ics')
    expect(text).toBe('BEGIN:VCALENDAR')
    // Ohne VITE_SUPABASE_URL (Test-Env) darf nur der statische Pfad geholt werden
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/calendar.ics')
  })

  it('wirft bei HTTP-Fehler des statischen Pfads', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 502 })))
    await expect(
      fetchCalendarText('https://export.kalender.digital/x.ics', '/api/calendar.ics'),
    ).rejects.toThrow('HTTP 502')
  })

  it('liefert bei Netzwerkfehler den zuletzt geladenen Kalender aus dem Offline-Cache', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('BEGIN:VCALENDAR', { status: 200 })))
    await fetchCalendarText('https://export.kalender.digital/x.ics', '/api/calendar.ics')

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const text = await fetchCalendarText('https://export.kalender.digital/x.ics', '/api/calendar.ics')
    expect(text).toBe('BEGIN:VCALENDAR')
  })
})

describe('lookupTwitchUserId (ohne Supabase-Env)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('nutzt den Fallback-Dienst und validiert die ID', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('123456', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const id = await lookupTwitchUserId('somebody', 'https://decapi.me/twitch/id/')
    expect(id).toBe('123456')
    expect(fetchMock).toHaveBeenCalledWith('https://decapi.me/twitch/id/somebody')
  })

  it('liefert null bei nicht-numerischer Antwort (z.B. "User not found")', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('User not found', { status: 200 })))
    expect(await lookupTwitchUserId('nobody', 'https://decapi.me/twitch/id/')).toBeNull()
  })

  it('liefert null bei Netzwerkfehler', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    expect(await lookupTwitchUserId('somebody', 'https://decapi.me/twitch/id/')).toBeNull()
  })
})
