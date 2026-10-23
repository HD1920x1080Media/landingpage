import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { User, Session } from '@supabase/supabase-js'
import { App as CapApp } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import { supabase } from '../lib/supabase'
import { isOffline, readCache, writeCache, removeCache } from '../lib/offlineStore'
import { isNativeApp, NATIVE_AUTH_CALLBACK } from '../lib/native'
import { AuthContext } from './authContextDef'

const REDIRECT_PATH_KEY = 'auth-redirect-path'
// Zuletzt angemeldeter User: Offline läuft der Access-Token ab und Supabase
// liefert keine Session mehr — der User soll aber offline weiterspielen können.
const LAST_USER_KEY = 'auth:lastUser'

/** Session → User; ohne Session offline auf den zuletzt bekannten User zurückfallen. */
function resolveUser(s: Session | null): User | null {
  if (s?.user) {
    writeCache(LAST_USER_KEY, s.user)
    return s.user
  }
  if (isOffline()) return readCache<User>(LAST_USER_KEY)?.data ?? null
  return null
}

/**
 * Lässt nur kanal-interne, relative Pfade als Redirect-Ziel zu. Verhindert
 * Open-Redirects (z.B. `//evil.com`, `https://…`, `javascript:…`), falls der
 * gespeicherte Wert manipuliert wurde.
 */
function isSafeInternalPath(path: string): boolean {
  return path.startsWith('/') && !path.startsWith('//')
}

/** Stellt Supabase-Auth-Status (User, Session) sowie Twitch-Login/Logout bereit
 *  und legt beim Login das Profil an. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  // Auth-Status-Änderungen beobachten (Login, Logout, Token-Refresh)
  useEffect(() => {
    // Initiale Session mit Retry-Logik holen — Supabase kann bei 503 kurz überfordert sein
    const getSessionWithRetry = async (retries = 2, delay = 1000) => {
      for (let i = 0; i <= retries; i++) {
        try {
          const { data: { session: s } } = await supabase.auth.getSession()
          setSession(s)
          setUser(resolveUser(s))
          setLoading(false)
          return
        } catch (err) {
          if (i === retries) {
            console.error('Failed to get session after retries:', err)
            setUser(resolveUser(null))
            setLoading(false)
            return
          }
          await new Promise(r => setTimeout(r, delay * (i + 1)))
        }
      }
    }

    getSessionWithRetry()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, s) => {
        if (event === 'SIGNED_OUT') removeCache(LAST_USER_KEY)
        setSession(s)
        setUser(resolveUser(s))
        setLoading(false)
      },
    )

    // Wieder online → Session erneut holen (Supabase erneuert dabei den Token)
    const onOnline = () => { void getSessionWithRetry(0) }
    window.addEventListener('online', onOnline)

    return () => {
      subscription.unsubscribe()
      window.removeEventListener('online', onOnline)
    }
  }, [])

  // Android-App: Twitch-Login kommt per Deep-Link zurück → Code gegen Session tauschen
  useEffect(() => {
    if (!isNativeApp()) return
    const listener = CapApp.addListener('appUrlOpen', async ({ url }) => {
      if (!url.startsWith(NATIVE_AUTH_CALLBACK)) return
      try {
        const parsed = new URL(url)
        const code = parsed.searchParams.get('code')
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code)
          if (error) console.error('Login fehlgeschlagen:', error)
        }
      } finally {
        void Browser.close().catch(() => {})
      }
    })
    return () => { void listener.then(l => l.remove()) }
  }, [])

  // Navigiere zum gespeicherten Pfad nach erfolgreicher Anmeldung
  useEffect(() => {
    if (user && session) {
      const savedPath = sessionStorage.getItem(REDIRECT_PATH_KEY)
      if (savedPath && savedPath !== '/' && savedPath !== '' && isSafeInternalPath(savedPath)) {
        sessionStorage.removeItem(REDIRECT_PATH_KEY)
        // Redirect nur, wenn wir nicht schon auf dem Ziel sind
        if (window.location.pathname !== savedPath) {
          window.location.replace(savedPath)
        }
      } else {
        sessionStorage.removeItem(REDIRECT_PATH_KEY)
      }
    }
  }, [user, session])

  // Profil anlegen und Rollen aus twitch_permissions → user_roles übertragen
  useEffect(() => {
    if (user) {
      const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

      const initProfile = async () => {
        // Upsert und RPC sequentiell mit Retry, da parallele Calls direkt nach dem
        // Login bei Supabase 503-Rate-Limit-Fehler auslösen
        const username = user.user_metadata?.user_login || user.user_metadata?.full_name || user.email
        if (username) {
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              const { error } = await supabase
                .from('profiles')
                .upsert({
                  id: user.id,
                  username: username,
                  updated_at: new Date().toISOString(),
                }, {
                  onConflict: 'id'
                })
              if (!error) break
              if (attempt < 2) await delay(1000 * (attempt + 1))
              else console.error('Failed to create profile:', error)
            } catch (err) {
              if (attempt < 2) await delay(1000 * (attempt + 1))
              else console.error('Failed to create profile:', err)
            }
          }
        }

        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const { data, error } = await supabase.rpc('transfer_permissions_to_roles')
            if (error) {
              if (attempt < 2) { await delay(1000 * (attempt + 1)); continue }
              console.error('Failed to transfer permissions to roles:', error)
            } else if (data?.error) {
              console.warn('Role transfer skipped:', data.error)
            }
            break
          } catch (err) {
            if (attempt < 2) await delay(1000 * (attempt + 1))
            else console.error('Failed to transfer permissions to roles:', err)
          }
        }
      }

      initProfile()
    }
  }, [user])

  const signInWithTwitch = useCallback(async () => {
    // Aktuellen Pfad speichern, damit nach dem Login dorthin zurückgeleitet werden kann
    const path = window.location.pathname || '/'
    sessionStorage.setItem(REDIRECT_PATH_KEY, path)

    if (isNativeApp()) {
      // Login im System-Browser (Custom Tab); Rückkehr per Deep-Link, siehe appUrlOpen oben
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'twitch',
        options: {
          redirectTo: NATIVE_AUTH_CALLBACK,
          scopes: 'user:read:subscriptions',
          skipBrowserRedirect: true,
        },
      })
      if (error || !data?.url) {
        console.error('Login konnte nicht gestartet werden:', error)
        return
      }
      await Browser.open({ url: data.url })
      return
    }

    await supabase.auth.signInWithOAuth({
      provider: 'twitch',
      options: {
        redirectTo: window.location.origin + window.location.pathname,
        scopes: 'user:read:subscriptions', // Zugriff auf Abo-Status des Nutzers anfragen
      },
    })
  }, [])

  const signOut = useCallback(async () => {
    removeCache(LAST_USER_KEY)
    await supabase.auth.signOut()
  }, [])

  return (
    <AuthContext.Provider value={{ user, session, loading, signInWithTwitch, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}
