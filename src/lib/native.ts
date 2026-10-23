/**
 * Brücke zur Android-App (Capacitor). Im Browser sind alle Funktionen No-Ops,
 * die Website verhält sich unverändert.
 */
import { Capacitor } from '@capacitor/core'

/** true, wenn der Code in der nativen Android-App läuft. */
export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform()
}

/** Deep-Link, auf den Supabase nach dem Twitch-Login zurückleitet.
 *  Muss in Supabase unter Auth → URL Configuration → Redirect URLs eingetragen sein. */
export const NATIVE_AUTH_CALLBACK = 'de.hd1920x1080.app://auth-callback'
