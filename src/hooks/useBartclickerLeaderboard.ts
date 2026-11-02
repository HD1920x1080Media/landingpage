import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { isOffline, readCache, writeCache } from '../lib/offlineStore';
import type { BartclickerLeaderboardEntry } from '../types/bartclicker';

interface LeaderboardRPCEntry {
  rank: number;
  user_id: string;
  total_ever: string | number;
  rebirth_count: number;
  last_updated: string;
  display_name: string;
}

const CACHE_KEY = 'bartclicker:leaderboard';

/** Lädt die Bartclicker-Bestenliste und aktualisiert sie alle 30 Sekunden.
 *  Offline wird die zuletzt geladene Liste angezeigt. */
export function useBartclickerLeaderboard() {
  const [entries, setEntriesState] = useState<BartclickerLeaderboardEntry[]>(
    () => readCache<BartclickerLeaderboardEntry[]>(CACHE_KEY)?.data ?? [],
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const setEntries = (list: BartclickerLeaderboardEntry[]) => {
      writeCache(CACHE_KEY, list);
      setEntriesState(list);
    };

    const loadLeaderboard = async () => {
      // Offline: gecachte Liste stehen lassen, kein Fehler-Spam
      if (isOffline()) {
        setIsLoading(false);
        return;
      }
      try {
        setIsLoading(true);
        setError(null);

        // Bevorzugter Weg: RPC liefert Scores inkl. Anzeigenamen in einer Abfrage
        const { data, error: fetchError } = await supabase.rpc(
          'get_bartclicker_leaderboard_with_names',
          { p_limit: 100 }
        );

        if (fetchError) {
          console.error('RPC Error:', fetchError);
          // Fallback ohne RPC: Scores und Profile getrennt laden und manuell zusammenführen
          const { data: scores, error: scoresError } = await supabase
            .from('bartclicker_scores')
            .select('user_id, total_ever, rebirth_count, last_updated')
            .gt('total_ever', 0)
            .order('total_ever', { ascending: false })
            .order('rebirth_count', { ascending: false })
            .limit(100);

          if (scoresError) {
            console.error('Error loading leaderboard:', scoresError);
            setError('Failed to load leaderboard');
            return;
          }

          if (scores) {
            const userIds = scores.map(s => s.user_id);
            const { data: profiles } = await supabase
              .from('profiles')
              .select('id, username')
              .in('id', userIds);

            const profileMap = new Map(profiles?.map(p => [p.id, p.username]) ?? []);

            const leaderboardEntries: BartclickerLeaderboardEntry[] = scores.map((entry, index) => {
              const displayName = profileMap.get(entry.user_id) || `Player ${index + 1}`;
              
              return {
                rank: index + 1,
                user_id: entry.user_id,
                total_ever: parseFloat(entry.total_ever.toString()) || 0,
                rebirth_count: entry.rebirth_count || 0,
                last_updated: entry.last_updated || new Date().toISOString(),
                display_name: displayName,
              };
            });

            setEntries(leaderboardEntries);
          }
          return;
        }

        if (data) {
          const leaderboardEntries: BartclickerLeaderboardEntry[] = data.map((entry: LeaderboardRPCEntry) => ({
            rank: entry.rank,
            user_id: entry.user_id,
            total_ever: parseFloat(entry.total_ever.toString()) || 0,
            rebirth_count: entry.rebirth_count || 0,
            last_updated: entry.last_updated,
            display_name: entry.display_name || `Player ${entry.rank}`,
          }));

          setEntries(leaderboardEntries);
        }
      } catch (err) {
        console.error('Failed to load leaderboard:', err);
        setError('Failed to load leaderboard');
      } finally {
        setIsLoading(false);
      }
    };

    loadLeaderboard();

    // Bestenliste alle 30 Sekunden neu laden
    const interval = setInterval(loadLeaderboard, 30000);
    return () => clearInterval(interval);
  }, []);

  return {
    entries,
    isLoading,
    error,
  };
}

