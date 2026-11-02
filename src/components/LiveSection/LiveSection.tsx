import {useState, useEffect, useRef} from 'react'
import {useTranslation} from 'react-i18next'
import siteConfig from '../../config/siteConfig'
import NextStream from '../NextStream/NextStream'
import CurrentGame from '../CurrentGame/CurrentGame'
import {supabase} from '../../lib/supabase'
import './LiveSection.css'

/* ── Typen fuer das Twitch-Player-SDK ── */
interface TwitchPlayerInstance {
    addEventListener(event: string, cb: () => void): void
}

declare global {
    interface Window {
        Twitch?: {
            Player: {
                new(
                    el: string | HTMLElement,
                    opts: Record<string, unknown>,
                ): TwitchPlayerInstance
                ONLINE: string
                OFFLINE: string
                READY: string
            }
        }
    }
}

/** Live-Bereich: prueft den Stream-Status und bettet bei Live-Betrieb Player und Chat ein. */
export default function LiveSection() {
    const {t} = useTranslation()
    const {channel} = siteConfig.twitch
    const parent =
        typeof window !== 'undefined' ? window.location.hostname : 'localhost'

    const [isLive, setIsLive] = useState<boolean | null>(null)
    const playerContainerRef = useRef<HTMLDivElement>(null)
    const playerCreated = useRef(false)

    /* ── Schritt 1: Live-Status per Supabase ermitteln (kein Twitch JS nötig) ── */
    useEffect(() => {
        let cancelled = false
        type TwitchGameResponse = { isLive: boolean }

        async function checkLiveStatus() {
            try {
                const {data} = await supabase.functions.invoke<TwitchGameResponse>('twitch-game')
                if (!cancelled) setIsLive(!!data?.isLive)
            } catch {
                if (!cancelled && isLive === null) setIsLive(false)
            }
        }

        checkLiveStatus()
        const interval = setInterval(checkLiveStatus, 30000)
        return () => {
            cancelled = true
            clearInterval(interval)
        }
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    /* ── Schritt 2: Twitch-SDK nur laden wenn live bestätigt ── */
    useEffect(() => {
        if (!isLive) return

        function createPlayer() {
            if (
                !window.Twitch?.Player ||
                !playerContainerRef.current ||
                playerCreated.current
            )
                return
            playerCreated.current = true

            const player = new window.Twitch.Player(playerContainerRef.current, {
                channel,
                parent: [parent],
                width: '100%',
                height: '100%',
                autoplay: true,
            })

            player.addEventListener(window.Twitch.Player.ONLINE, () => setIsLive(true))
            player.addEventListener(window.Twitch.Player.OFFLINE, () => setIsLive(false))
        }

        if (window.Twitch?.Player) {
            createPlayer()
            return
        }

        const existing = document.querySelector('script[src*="player.twitch.tv"]')
        if (existing) {
            const id = setInterval(() => {
                if (window.Twitch?.Player) {
                    clearInterval(id)
                    createPlayer()
                }
            }, 200)
            return () => clearInterval(id)
        }

        const script = document.createElement('script')
        script.src = 'https://player.twitch.tv/js/embed/v1.js'
        script.async = true
        script.onload = createPlayer
        document.head.appendChild(script)
    }, [isLive, channel, parent])

    const showStream = isLive === true

    return (
        <section className="live-section" aria-label={t('live.sectionLabel')}>
            <div className="embed-card">
                <a
                    href={`https://www.twitch.tv/${channel}`}
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    <div className="embed-title">
                        {showStream ? t('live.title') : t('live.offlineTitle')}
                    </div>
                </a>

                {/* ── Offline → nächster Termin ── */}
                {!showStream && <NextStream/>}

                {/* ── Aktuelles Spiel (nur waehrend des Streams) ── */}
                <CurrentGame isLive={showStream}/>
                <p></p>
                <div className={`embed-row ${!showStream ? 'embed-row--hidden' : ''}`}>
                    <div className="embed-player" ref={playerContainerRef} style={{ minHeight: 400 }}></div>
                    {showStream && (
                        <div className="embed-chat">
                            <iframe
                                src={`https://www.twitch.tv/embed/${channel}/chat?parent=${parent}&darkpopout`}
                                title="Twitch Chat"
                                allow="autoplay; fullscreen"
                            />
                        </div>
                    )}
                </div>

                <p></p>
            </div>
        </section>
    )
}
