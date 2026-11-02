import { useEffect } from 'react'
import { useNavigate } from 'react-router'
import { App as CapApp } from '@capacitor/app'
import { isNativeApp } from '../../lib/native'

/** Android-spezifisches Verhalten: Hardware-Zurück-Taste navigiert in der App
 *  zurück und schließt sie erst auf der Startseite. Im Browser ohne Wirkung. */
export default function NativeAppShell() {
  const navigate = useNavigate()

  useEffect(() => {
    if (!isNativeApp()) return
    const listener = CapApp.addListener('backButton', ({ canGoBack }) => {
      if (canGoBack && window.location.pathname !== '/') {
        navigate(-1)
      } else {
        void CapApp.exitApp()
      }
    })
    return () => { void listener.then(l => l.remove()) }
  }, [navigate])

  return null
}
