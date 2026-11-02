/**
 * Offline-Datenspeicher für Web und Android-App.
 *
 * Alle über das Netz geladenen Daten (Bestenliste, Clip-Voting, Kalender, …)
 * werden hier als JSON-Snapshot mit Zeitstempel abgelegt. Ist das Gerät
 * offline oder schlägt ein Request fehl, liefern die Hooks den letzten
 * Snapshot aus. In der Android-App liegt localStorage im App-Datenverzeichnis
 * (persistent, per Auto-Backup gesichert).
 */

const PREFIX = 'offline:v1:'

export interface CacheEntry<T> {
  data: T
  /** Unix-ms, wann der Snapshot geschrieben wurde. */
  savedAt: number
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    // z. B. Safari Private Mode / gesperrte Storage-API
    return null
  }
}

/** Liest einen Snapshot; null wenn nicht vorhanden oder unlesbar. */
export function readCache<T>(key: string): CacheEntry<T> | null {
  const s = storage()
  if (!s) return null
  try {
    const raw = s.getItem(PREFIX + key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CacheEntry<T>
    if (!parsed || typeof parsed.savedAt !== 'number' || !('data' in parsed)) return null
    return parsed
  } catch {
    return null
  }
}

/** Schreibt einen Snapshot. Fehler (Quota voll) werden geschluckt – Cache ist Best-Effort. */
export function writeCache<T>(key: string, data: T, savedAt = Date.now()): void {
  const s = storage()
  if (!s) return
  try {
    s.setItem(PREFIX + key, JSON.stringify({ data, savedAt } satisfies CacheEntry<T>))
  } catch (err) {
    console.warn(`[offlineStore] Snapshot "${key}" konnte nicht gespeichert werden:`, err)
  }
}

export function removeCache(key: string): void {
  storage()?.removeItem(PREFIX + key)
}

/** true, wenn der Browser/WebView meldet, dass keine Verbindung besteht. */
export function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

/**
 * Network-first mit Offline-Fallback: Holt frische Daten und speichert sie;
 * schlägt das fehl (oder ist das Gerät offline), wird der letzte Snapshot
 * geliefert. Ohne Snapshot wird der ursprüngliche Fehler weitergeworfen.
 */
export async function fetchWithOfflineCache<T>(
  key: string,
  fetcher: () => Promise<T>,
): Promise<{ data: T; fromCache: boolean; savedAt: number }> {
  if (!isOffline()) {
    try {
      const data = await fetcher()
      const savedAt = Date.now()
      writeCache(key, data, savedAt)
      return { data, fromCache: false, savedAt }
    } catch (err) {
      const cached = readCache<T>(key)
      if (cached) return { data: cached.data, fromCache: true, savedAt: cached.savedAt }
      throw err
    }
  }

  const cached = readCache<T>(key)
  if (cached) return { data: cached.data, fromCache: true, savedAt: cached.savedAt }
  throw new Error('offline')
}
