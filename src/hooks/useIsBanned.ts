import { useEffect, useState } from 'react';
import { useAuth } from '../context/useAuth';
import { supabase } from '../lib/supabase';
import { isOffline, readCache, writeCache } from '../lib/offlineStore';

/** Prüft anhand der Twitch-ID des eingeloggten Users, ob dessen Account gesperrt ist. */
export function useIsBanned() {
  const { user, loading: authLoading } = useAuth();
  const [isBanned, setIsBanned] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;
    async function checkBan() {
      if (authLoading) return;
      if (!user) {
        setIsBanned(false);
        setLoading(false);
        return;
      }
      // Twitch-ID liegt je nach OAuth-Antwort unter provider_id oder sub
      const twitchId = user.user_metadata?.provider_id || user.user_metadata?.sub;
      if (!twitchId) {
        setIsBanned(false);
        setLoading(false);
        return;
      }
      // Offline den zuletzt bekannten Ban-Status verwenden, damit eine Sperre
      // nicht durch Flugmodus umgangen werden kann.
      const cacheKey = `banned:${twitchId}`;
      if (isOffline()) {
        if (!cancelled) {
          setIsBanned(readCache<boolean>(cacheKey)?.data ?? false);
          setLoading(false);
        }
        return;
      }
      const { data, error } = await supabase
        .from('banned_accounts')
        .select('twitch_user_id')
        .eq('twitch_user_id', twitchId)
        .maybeSingle();
      const banned = error ? (readCache<boolean>(cacheKey)?.data ?? false) : !!data;
      if (!error) writeCache(cacheKey, banned);
      if (!cancelled) {
        setIsBanned(banned);
        setLoading(false);
      }
    }
    checkBan();
    return () => { cancelled = true; };
  }, [user, authLoading]);

  return { isBanned, loading };
}
