# 📱 Android-App (Play-Store-ready)

Die Android-App ist eine [Capacitor](https://capacitorjs.com)-Hülle um genau dieselbe
React-App wie die Website. Der komplette Web-Build (inkl. Bilder, Sounds) wird **in die
App gebündelt** — sie startet also auch ganz ohne Internet.

| | |
|---|---|
| Package-Name | `de.hd1920x1080.app` |
| minSdk / targetSdk | 24 (Android 7) / 36 (Android 16) |
| Format | AAB (Play Store) + APK (Sideload/Test) |

---

## Offline-Verhalten

| Bereich | Offline | Sync |
|---|---|---|
| **Bartclicker** | Voll spielbar. Spielstand wird alle 2 s + beim Schließen lokal gesichert. | Beim Wieder-Online-Gehen automatisch über `save_bartclicker_state` hochgeladen. Liegt der Server vorne (auf anderem Gerät weitergespielt), gewinnt der Server. |
| Login | Zuletzt angemeldeter User bleibt offline erhalten (auch wenn der Token abläuft). | Token wird beim Online-Gehen erneuert. |
| Bartclicker-Bestenliste | Letzter Stand | alle 30 s |
| Clip des Monats | Letzter Stand (Abstimmen erst wieder online) | alle 30 s |
| Streamplan / Nächster Stream | Letzter geladener Kalender | bei jedem Öffnen |
| Ban-Status | Letzter bekannter Status | bei jedem Start |

Technik: `src/lib/offlineStore.ts` (Snapshot-Cache), `src/lib/bartclickerOffline.ts`
(Spielstand + Konfliktregel), `src/hooks/useOnlineStatus.ts`, Offline-Hinweis
`src/components/OfflineBanner`. Alles funktioniert genauso auf der Website.

Die Daten liegen im App-Speicher und werden per **Android-Auto-Backup** gesichert
(`android/app/src/main/res/xml/data_extraction_rules.xml`) — bei Gerätewechsel ist der
Spielstand also mit dabei.

Die Server-Anti-Cheat-Prüfung braucht **keine Änderung**: Die Wachstumsgrenze rechnet
mit der Zeit seit dem letzten Server-Save, offline erspielter Fortschritt passt hinein.

---

## Einmalige Einrichtung

### 1. Supabase: Redirect-URL für den App-Login
Supabase Dashboard → **Authentication → URL Configuration → Redirect URLs** →
hinzufügen:

```
de.hd1920x1080.app://auth-callback
```

Der Twitch-Login öffnet sich in der App im System-Browser (Custom Tab) und springt per
Deep-Link zurück (PKCE-Flow). In der Twitch-Developer-Console ist **nichts** zu ändern —
dort bleibt die Supabase-Callback-URL eingetragen.

### 2. Kontaktformular
Die Edge Function `contact` erlaubt jetzt zusätzlich den App-Origin `https://localhost`.
Einmal neu deployen: `supabase functions deploy contact`.

### 3. Upload-Keystore erzeugen (einmalig, **sicher aufbewahren!**)
```bash
keytool -genkeypair -v -keystore release.jks -alias hd1920x1080 \
  -keyalg RSA -keysize 4096 -validity 10000
```
Ohne diesen Keystore (bzw. ohne Play App Signing) kann die App nie wieder aktualisiert
werden. Empfehlung: In der Play Console **Play App Signing** aktivieren — dann ist das
nur der Upload-Key und im Verlustfall ersetzbar.

### 4. GitHub Secrets (für den CI-Build `.github/workflows/android.yml`)
| Secret | Inhalt |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | `base64 -w0 release.jks` |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore-Passwort |
| `ANDROID_KEY_ALIAS` | z. B. `hd1920x1080` |
| `ANDROID_KEY_PASSWORD` | Key-Passwort |

Die `VITE_*`-Secrets der Website werden mitbenutzt. Ohne Keystore-Secrets baut CI ein
unsigniertes AAB (gut zum Testen des Builds).

`versionCode` = `100 + Run-Nummer` (steigt automatisch), `versionName` = letzter `vX.Y.Z`-Tag.

---

## Lokal bauen

Voraussetzungen: Node 22+, JDK 21, Android SDK (Android Studio).

```bash
npm run android:sync     # Web-Build + in android/ kopieren
npm run android:open     # In Android Studio öffnen (Emulator/Gerät starten)
cp android/keystore.properties.example android/keystore.properties   # ausfüllen
npm run android:bundle   # → android/app/build/outputs/bundle/release/app-release.aab
```

Icons neu erzeugen (Quellbild ≥ 1024×1024 empfohlen — aktuell 200×200-Profilbild hochskaliert):
```bash
npm run android:icons -- pfad/zum/logo.png
```

---

## Play-Store-Checkliste

- [ ] Developer-Account (einmalig 25 $), App anlegen mit Package `de.hd1920x1080.app`
- [ ] Play App Signing aktivieren, signiertes AAB hochladen (erst *Interner Test*)
- [ ] **Datenschutzerklärung-URL**: `https://hd1920x1080.de/datenschutz` (App-Nutzung + lokale Speicherung ergänzen)
- [ ] **Data Safety**-Formular: Twitch-Login (User-ID, Name), Spielstand, Seitenaufrufe (nur nach Cookie-Zustimmung); Übertragung verschlüsselt; Löschung auf Anfrage
- [ ] Inhaltsbewertung (IARC-Fragebogen), Zielgruppe (nicht für Kinder)
- [ ] Store-Eintrag: Icon `android/store/play-store-icon-512.png` (besser hochauflösend neu erzeugen), Feature-Grafik 1024×500, mind. 2 Screenshots
- [ ] Neue private Entwickler-Accounts: **geschlossener Test mit 12 Testern über 14 Tage** vor der Produktionsfreigabe (Google-Vorgabe)
- [ ] Jede neue Version: höherer `versionCode` (CI erledigt das)

Bereits erledigt im Projekt: targetSdk 36, nur HTTPS (kein Cleartext), Release-Build
minifiziert + signiert, WebView-Debugging im Release aus, Backup-Regeln, eigenes Icon
und Splash, Android-Zurück-Taste, Deep-Link-Login.
