import {Routes, Route, Navigate, useLocation, BrowserRouter} from 'react-router'
import {useLayoutEffect, lazy, Suspense} from 'react'
import SettingsBar from './components/SettingsBar/SettingsBar.tsx'
import CookieBanner from './components/CookieBanner/CookieBanner'
import PageTracker from './components/PageTracker'
import OfflineBanner from './components/OfflineBanner/OfflineBanner'
import NativeAppShell from './components/NativeAppShell/NativeAppShell'
import ProtectedRoute from './components/ProtectedRoute/ProtectedRoute'
import ModeratorRoute from './components/ModeratorRoute/ModeratorRoute'
import BroadcasterRoute from './components/BroadcasterRoute/BroadcasterRoute'
import './App.css'
import siteConfig from "./config/siteConfig.ts";
import * as React from "react";
import { useIsBanned } from './hooks/useIsBanned';
import { useTranslation } from 'react-i18next';

const HomePage = lazy(() => import('./pages/HomePage'))
const ImpressumPage = lazy(() => import('./pages/ImpressumPage'))
const DatenschutzPage = lazy(() => import('./pages/DatenschutzPage'))
const StreamplanPage = lazy(() => import('./pages/StreamplanPage/StreamplanPage'))
const StreamelementsPage = lazy(() => import('./pages/StreamelementsPage'))
const BartclickerPage = lazy(() => import('./pages/BartclickerPage'))
const ClipVotingPage = lazy(() => import('./pages/ClipVotingPage'))
const ModeratePage = lazy(() => import('./pages/ModeratePage'))
const ModerateVotingPage = lazy(() => import('./pages/ModerateVotingPage'))
const ModerateStatisticsPage = lazy(() => import('./pages/ModerateStatisticsPage/ModerateStatisticsPage'))
const ModerateSettingsPage = lazy(() => import('./pages/ModerateSettingsPage'))
const OnlyBartPage = lazy(() => import('./pages/OnlyBartPage/OnlyBartPage'))
const NotFoundPage = lazy(() => import('./pages/NotFoundPage/NotFoundPage'))
const ModerateAccountPage = lazy(() => import('./pages/ModerateAccountPage'))
const ModerateDonationTriggersPage = lazy(() => import('./pages/ModerateDonationTriggersPage'))

/** Erzwingt einen vollen Browser-Wechsel (kompletter Reload) statt eines React-Router-Wechsels. */
const RedirectToHtml: React.FC<{ to: string }> = ({ to }) => {
    useLayoutEffect(() => {
        window.location.href = to
    }, [to])
    return null
}
const {channel} = siteConfig.twitch
const {impressum, redirects} = siteConfig
const externalRedirects: Record<string, string> = {
    ...redirects,
    "/twitch": `https://www.twitch.tv/${channel}`,
};

/** Leitet bekannte Kurz-Pfade per voller Browser-Navigation auf externe Ziele um. */
const ExternalRedirectHandler = () => {
    const { pathname } = useLocation();

    useLayoutEffect(() => {
        const target = externalRedirects[pathname];
        if (target) {
            window.location.href = target;
        }
    }, [pathname]);

    return null;
};

/** Wurzel-Komponente: Routing, globale Leisten und Ban-Gate für den gesamten Auftritt. */
function App() {
    const { isBanned, loading: banLoading } = useIsBanned();
    const { t } = useTranslation();

    useLayoutEffect(() => {
        // Platzhalter für künftige Effekte (z.B. Analytics)
    }, []);

    if (banLoading) {
        return (
            <div style={{ textAlign: 'center', padding: '40px 20px' }}>
                <div className="auth-spinner" />
                <p>{t('auth.loading')}</p>
            </div>
        );
    }
    if (isBanned) {
        return (
            <div style={{ textAlign: 'center', padding: '40px 20px' }}>
                <div className="auth-gate-icon" style={{ fontSize: 48 }}>⛔</div>
                <h1>{t('banned.title', 'Account gesperrt')}</h1>
                <p>{t('banned.message', 'Dein Account wurde gesperrt. Bei Fragen wende dich bitte an den Support.')}</p>
                <a href={`mailto:${impressum.email}?subject=Gebannt`} style={{ color: '#007bff', textDecoration: 'underline' }}>Support</a>
            </div>
        );
    }

    return (
        <BrowserRouter>
            <NativeAppShell/>
            <OfflineBanner/>
            <SettingsBar/>
            <PageTracker/>
            <Suspense fallback={null}>
             <Routes>
                 {Object.keys(externalRedirects).map((path) => (
                    <Route key={path} path={path} element={<ExternalRedirectHandler />} />
                ))}
                <Route path="/" element={<HomePage/>}/>
                <Route path="/impressum" element={<ImpressumPage/>}/>
                <Route path="/datenschutz" element={<DatenschutzPage/>}/>
                <Route path="/streamplan" element={<StreamplanPage/>}/>
                <Route path="/streamelements" element={<StreamelementsPage/>}/>

                {/* ── Login zum Aufrufen nötig ── */}
                <Route path="/bartclicker" element={<ProtectedRoute><BartclickerPage/></ProtectedRoute>}/>

                {/* ── Seite öffentlich, Voting braucht Login ── */}
                <Route path="/clipdesmonats" element={<ClipVotingPage/>}/>

                {/* ── Moderatoren-Bereich (Twitch-Mods + Streamer) ── */}
                <Route path="/moderate" element={<ModeratorRoute><ModeratePage/></ModeratorRoute>}/>
                <Route path="/moderate/voting" element={<ModeratorRoute><ModerateVotingPage/></ModeratorRoute>}/>
                <Route path="/moderate/statistics"
                       element={<ModeratorRoute><ModerateStatisticsPage/></ModeratorRoute>}/>
                <Route path="/moderate/twitch"
                       element={<RedirectToHtml to={`https://www.twitch.tv/moderator/${channel}`}/>}/>
                <Route path="/moderate/settings"
                       element={<BroadcasterRoute><ModerateSettingsPage/></BroadcasterRoute>}/>
                <Route path="/moderate/account"
                       element={<ModeratorRoute><ModerateAccountPage/></ModeratorRoute>}/>
                <Route path="/moderate/triggers"
                       element={<ModeratorRoute><ModerateDonationTriggersPage/></ModeratorRoute>}/>

                {/* ── Interne Kurz-Pfade: bewusst hier als React-Router-Weiterleitungen, damit kein voller Reload nötig ist ── */}
                <Route path="/actuator/data" element={<Navigate to="/moderate/statistics" replace/>}/>
                <Route path="/se" element={<Navigate to="/streamelements" replace/>}/>
                <Route path="/s" element={<Navigate to="/streamplan" replace/>}/>
                <Route path="/ob" element={<Navigate to="/onlybart" replace/>}/>
                <Route path="/bc" element={<Navigate to="/bartclicker" replace/>}/>
                <Route path="/cdm" element={<Navigate to="/clipdesmonats" replace/>}/>

                <Route path="/onlybart" element={<OnlyBartPage/>}/>
                <Route path="/onlybart/*" element={<Navigate to="/onlybart" replace/>}/>

                {/* ── Hart kodierte Sonder-Weiterleitungen; redundant zu siteConfig.redirects, hier als Sicherheitsnetz ── */}
                <Route path="/rp" element={<RedirectToHtml to="https://github.com/HD1920x1080Media/Minecraft-Ressource-Pack/archive/refs/tags/latest.zip"/>}/>
                <Route path="/ressourcepack" element={<RedirectToHtml to="https://github.com/HD1920x1080Media/Minecraft-Ressource-Pack/archive/refs/tags/latest.zip"/>}/>
                <Route path="/tanggle" element={<RedirectToHtml to="http://tng.gl/c/hd1920x1080"/>}/>
                <Route path="/puzzle" element={<RedirectToHtml to="http://tng.gl/c/hd1920x1080"/>}/>
                <Route path="/nclip" element={<RedirectToHtml to="https://nclip.io/page/hd1920x1080"/>}/>
                <Route path={"/StreamElements.html"} element={<Navigate to="/streamelements" replace/>}/>

                <Route path="*" element={<NotFoundPage/>}/>
            </Routes>
            </Suspense>
            <CookieBanner/>
        </BrowserRouter>
    )
}

export default App
