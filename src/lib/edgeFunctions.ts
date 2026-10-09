/**
 * Helfer für Aufrufe der Supabase Edge Functions — mit Fallback, damit die
 * Seite ohne Supabase (reine statische Linkpage) unverändert funktioniert.
 *
 * Die reinen URL-Bau-Funktionen sind bewusst parameterisiert (statt direkt
 * import.meta.env zu lesen), damit sie testbar bleiben.
 */
import { fetchWithOfflineCache } from './offlineStore'

/** Baut die URL einer Edge Function; null wenn keine Supabase-URL konfiguriert ist. */
export function buildEdgeFunctionUrl(
  supabaseUrl: string | undefined,
  name: string,
  params?: Record<string, string>,
): string | null {
  if (!supabaseUrl) return null
  const base = supabaseUrl.replace(/\/+$/, '')
  const qs = params ? `?${new URLSearchParams(params).toString()}` : ''
  return `${base}/functions/v1/${name}${qs}`
}

function supabaseEnv(): { url?: string; anonKey?: string } {
  return {
    url: import.meta.env.VITE_SUPABASE_URL as string | undefined,
    anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined,
  }
}

/** Auth-Header für Edge-Function-Aufrufe (anon key, wie bei twitch-game/check-stores). */
function edgeHeaders(anonKey: string): HeadersInit {
  return { apikey: anonKey, Authorization: `Bearer ${anonKey}` }
}

/**
 * Lädt einen ICS-Kalender: bevorzugt live über die calendar-Edge-Function
 * (immer aktuell), bei Fehlern oder ohne Supabase über den statischen
 * Build-Snapshot (`/api/calendar*.ics`).
 */
export async function fetchCalendarText(liveIcsUrl: string, staticPath: string): Promise<string> {
  // Letzten erfolgreich geladenen Kalender offline weiterverwenden
  const { data } = await fetchWithOfflineCache(`calendar:${liveIcsUrl || staticPath}`, () =>
    fetchCalendarTextOnline(liveIcsUrl, staticPath),
  )
  return data
}

async function fetchCalendarTextOnline(liveIcsUrl: string, staticPath: string): Promise<string> {
  const { url, anonKey } = supabaseEnv()
  const edgeUrl = buildEdgeFunctionUrl(url, 'calendar', { url: liveIcsUrl })

  if (edgeUrl && anonKey && liveIcsUrl.startsWith('https://')) {
    try {
      const res = await fetch(edgeUrl, { headers: edgeHeaders(anonKey) })
      if (res.ok) return await res.text()
    } catch {
      // Edge Function nicht deployt/erreichbar → statischer Fallback unten
    }
  }

  const res = await fetch(staticPath)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

/**
 * Löst einen Twitch-Login-Namen zur numerischen User-ID auf: bevorzugt über
 * die twitch-user-Edge-Function (Helix-API, keine Drittanbieter), bei Fehlern
 * über den konfigurierten Fallback-Dienst (decapi).
 */
export async function lookupTwitchUserId(
  login: string,
  fallbackLookupUrl: string,
): Promise<string | null> {
  const { url, anonKey } = supabaseEnv()
  const edgeUrl = buildEdgeFunctionUrl(url, 'twitch-user', { login })

  if (edgeUrl && anonKey) {
    try {
      const res = await fetch(edgeUrl, { headers: edgeHeaders(anonKey) })
      if (res.ok) {
        const data = await res.json() as { id?: string }
        if (data.id && /^\d+$/.test(data.id)) return data.id
      }
      if (res.status === 404) return null // User existiert nicht — kein Fallback nötig
    } catch {
      // Edge Function nicht deployt/erreichbar → Fallback unten
    }
  }

  try {
    const res = await fetch(`${fallbackLookupUrl}${encodeURIComponent(login)}`)
    if (!res.ok) return null
    const id = (await res.text()).trim()
    return /^\d+$/.test(id) ? id : null
  } catch {
    return null
  }
}
