import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/useAuth'
import { isOffline, readCache, writeCache } from '../lib/offlineStore'
import type {
  VotingRound,
  ClipWithVotes,
  MonthlyWinner,
  YearlyWinner,
  VotingPhase,
  VotingState,
} from '../types/clipVoting'

/** Leitet die anzuzeigende UI-Phase aus der jeweils aktivsten Voting-Runde ab.
 *  Priorität: aktive Runde vor ausstehender vor abgeschlossener. */
export function derivePhase(
  active: VotingRound | null,
  pending: VotingRound | null,
  completed: VotingRound | null,
): VotingPhase {
  if (active) {
    if (active.type === 'round1') return 'round1-active'
    if (active.type === 'round2') return 'round2-active'
    return 'yearly-active'
  }
  if (pending) {
    // Runde 2 steht noch aus → solange die Ergebnisse von Runde 1 zeigen
    if (pending.type === 'round2') return 'round1-results'
    return 'no-round'
  }
  if (completed) {
    if (completed.type === 'round1') return 'round1-results'
    if (completed.type === 'round2') return 'round2-results'
    if (completed.type === 'yearly') return 'yearly-results'
  }
  return 'no-round'
}

/** Liefert den kompletten Zustand des Clip-Votings (Phase, Runde, Clips, Sieger)
 *  und eine castVote-Funktion. Pollt alle 30 Sekunden. */
export function useClipVoting(): VotingState & {
  castVote: (clipId: string) => Promise<{ error?: string }>
  refresh: () => void
} {
  const { user } = useAuth()
  const [state, setState] = useState<VotingState>({
    phase: 'loading',
    round: null,
    clips: [],
    userVote: null,
    monthlyWinner: null,
    yearlyWinner: null,
    previousYearlyWinner: null,
    loading: true,
    error: null,
  })

  // Offline-Snapshot je User (userVote ist nutzerspezifisch)
  const cacheKey = `clipvoting:state:${user?.id ?? 'anon'}`

  // Lädt alle für die UI benötigten Daten in einem Durchgang
  const fetchState = useCallback(async () => {
    // Offline: letzten Stand anzeigen statt einer leeren Seite
    const showCached = (): boolean => {
      const cached = readCache<VotingState>(cacheKey)
      if (!cached) return false
      setState({ ...cached.data, loading: false, error: null })
      return true
    }
    if (isOffline() && showCached()) return

    try {
      // 1 — Die letzten Voting-Runden laden, um daraus die aktuelle Phase abzuleiten
      const { data: rounds, error: roundsError } = await supabase
        .schema('clipvoting')
        .from('voting_rounds')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10)
      if (roundsError) throw new Error(roundsError.message)

      const list = (rounds ?? []) as VotingRound[]
      const active    = list.find((r) => r.status === 'active')    ?? null
      const pending   = list.find((r) => r.status === 'pending')   ?? null
      const completed = list.find((r) => r.status === 'completed') ?? null

      const phase = derivePhase(active, pending, completed)

      // Runde, deren Clips angezeigt werden
      const displayRound: VotingRound | null = active ?? pending ?? completed

      // 2 — Clips der anzuzeigenden Runde laden
      let clips: ClipWithVotes[] = []
      if (displayRound) {
        // Solange Runde 2 nur "pending" ist, die Clips der abgeschlossenen Runde 1
        // zeigen – sonst sähen Zuschauer eine leere Runde
        const roundIdForClips =
          displayRound.status === 'pending'
            ? list.find(
                (r) =>
                  r.type === 'round1' &&
                  r.status === 'completed' &&
                  r.year === displayRound!.year &&
                  r.month === displayRound!.month,
              )?.id ?? displayRound.id
            : displayRound.id

        const { data } = await supabase
          .schema('clipvoting')
          .from('clip_vote_counts')
          .select('*')
          .eq('round_id', roundIdForClips)
          .order('vote_count', { ascending: false })

        clips = (data ?? []) as ClipWithVotes[]
      }

      // 3 — Eigene Stimme des Users in der aktiven Runde laden
      let userVote: string | null = null
      if (active && user) {
        const { data } = await supabase
          .schema('clipvoting')
          .from('votes')
          .select('clip_id')
          .eq('round_id', active.id)
          .eq('user_id', user.id)
          .maybeSingle()
        userVote = (data as { clip_id: string } | null)?.clip_id ?? null
      }

      // 4 — Aktuellsten Monatssieger laden
      const { data: mw } = await supabase
        .schema('clipvoting')
        .from('monthly_winners')
        .select('*, clips(*)')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      // 5 — Die letzten zwei Jahressieger laden (aktuelles und vorheriges Jahr)
      const { data: ywList } = await supabase
        .schema('clipvoting')
        .from('yearly_winners')
        .select('*, clips(*)')
        .order('year', { ascending: false })
        .limit(2)

      const yearlyWinners = (ywList ?? []) as YearlyWinner[]

      const next: VotingState = {
        phase: phase === 'loading' ? 'no-round' : phase,
        round: displayRound,
        clips,
        userVote,
        monthlyWinner: (mw as MonthlyWinner | null) ?? null,
        yearlyWinner: yearlyWinners[0] ?? null,
        previousYearlyWinner: yearlyWinners[1] ?? null,
        loading: false,
        error: null,
      }
      writeCache(cacheKey, next)
      setState(next)
    } catch (err) {
      if (showCached()) return
      setState((prev) => ({
        ...prev,
        phase: 'no-round',
        loading: false,
        error: err instanceof Error ? err.message : 'unknown',
      }))
    }
  }, [user, cacheKey])

  useEffect(() => {
    fetchState()
    const id = setInterval(fetchState, 30_000)
    return () => clearInterval(id)
  }, [fetchState])

  const castVote = useCallback(
    async (clipId: string): Promise<{ error?: string }> => {
      if (!state.round || state.round.status !== 'active')
        return { error: 'round_not_active' }
      if (isOffline()) return { error: 'offline' }

      const { data, error } = await supabase.rpc('cast_vote', {
        p_round_id: state.round.id,
        p_clip_id: clipId,
      })

      if (error) return { error: error.message }
      const result = data as { error?: string; success?: boolean } | null
      if (result?.error) return { error: result.error }

      // Optimistisches Update: userVote sofort setzen, danach echten Stand nachladen
      setState((prev) => ({ ...prev, userVote: clipId }))
      await fetchState()
      return {}
    },
    [state.round, fetchState],
  )

  return { ...state, castVote, refresh: fetchState }
}


