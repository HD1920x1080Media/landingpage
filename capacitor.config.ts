import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Capacitor-Konfiguration für die Android-App.
 * Die App bündelt den kompletten Vite-Build (dist/) lokal — dadurch startet sie
 * auch ohne Internet. Daten werden in src/lib/offlineStore.ts gesichert und
 * beim nächsten Online-Gang synchronisiert.
 */
const config: CapacitorConfig = {
  appId: 'de.hd1920x1080.app',
  appName: 'HD1920x1080',
  webDir: 'dist',
  android: {
    // Kein Mixed Content: alle APIs (Supabase, Twitch) laufen über HTTPS.
    allowMixedContent: false,
    // Release-Builds sollen kein WebView-Debugging erlauben (Play-Store-Policy).
    webContentsDebuggingEnabled: false,
  },
  server: {
    // https://localhost als Origin — Supabase/Edge-Functions erlauben CORS dafür.
    androidScheme: 'https',
  },
}

export default config
