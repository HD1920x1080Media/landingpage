import { useTranslation } from 'react-i18next'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'
import './OfflineBanner.css'

/** Dezenter Hinweis, solange keine Verbindung besteht: Inhalte stammen aus dem Offline-Speicher. */
export default function OfflineBanner() {
  const online = useOnlineStatus()
  const { t } = useTranslation()
  if (online) return null
  return (
    <div className="offline-banner" role="status" aria-live="polite">
      <span aria-hidden="true">📴</span> {t('offline.banner')}
    </div>
  )
}
