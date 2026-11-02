/**
 * Lokaler Bartclicker-Spielstand für Offline-Spielen.
 *
 * Der Spielstand wird laufend lokal gesichert (Snapshot + "dirty"-Flag).
 * Solange kein Netz da ist, spielt man auf dem lokalen Stand weiter; sobald
 * wieder eine Verbindung besteht, wird er über die validierende RPC
 * save_bartclicker_state hochgeladen. Die Server-Wachstumsgrenze rechnet mit
 * der Zeit seit dem letzten Server-Save, Offline-Fortschritt wird daher
 * akzeptiert.
 */
import { readCache, writeCache, removeCache } from './offlineStore'
import type { BartclickerGameState } from '../types/bartclicker'

export interface LocalGameSnapshot {
  state: BartclickerGameState
  /** true = enthält Fortschritt, der noch nicht auf dem Server ist. */
  dirty: boolean
}

const key = (userId: string) => `bartclicker:state:${userId}`

export function readGameSnapshot(userId: string): (LocalGameSnapshot & { savedAt: number }) | null {
  const entry = readCache<LocalGameSnapshot>(key(userId))
  if (!entry?.data?.state) return null
  return { ...entry.data, savedAt: entry.savedAt }
}

/** Speichert den Spielstand lokal und liefert den verwendeten Zeitstempel zurück. */
export function writeGameSnapshot(userId: string, state: BartclickerGameState, dirty: boolean): number {
  const savedAt = Date.now()
  writeCache<LocalGameSnapshot>(key(userId), { state, dirty }, savedAt)
  return savedAt
}

/**
 * Markiert den Snapshot als synchronisiert — aber nur, wenn seit dem Upload
 * kein neuerer Stand lokal gesichert wurde (sonst ginge dieser verloren).
 */
export function markGameSnapshotSynced(userId: string, uploadedSavedAt: number): void {
  const current = readGameSnapshot(userId)
  if (!current || current.savedAt !== uploadedSavedAt) return
  writeCache<LocalGameSnapshot>(key(userId), { state: current.state, dirty: false }, current.savedAt)
}

export function clearGameSnapshot(userId: string): void {
  removeCache(key(userId))
}

/**
 * Entscheidet, ob der lokale Snapshot dem Server-Stand vorgezogen wird.
 * Lokal gewinnt nur, wenn er unsynchronisierten Fortschritt enthält und nicht
 * hinter dem Server liegt (z. B. weil auf einem anderen Gerät weitergespielt
 * wurde — dann ist der Server maßgeblich).
 */
export function shouldPreferLocal(
  local: { dirty: boolean; state: Pick<BartclickerGameState, 'total_ever'> } | null,
  server: { total_ever: number | string } | null,
): boolean {
  if (!local) return false
  if (!server) return true
  if (!local.dirty) return false
  const serverTotal = Number(server.total_ever)
  const localTotal = Number(local.state.total_ever)
  return localTotal >= (Number.isFinite(serverTotal) ? serverTotal : 0)
}
