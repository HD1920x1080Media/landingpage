import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useAuth } from '../context/useAuth';
import { supabase } from '../lib/supabase';
import { isOffline } from '../lib/offlineStore';
import {
  readGameSnapshot,
  writeGameSnapshot,
  markGameSnapshotSynced,
  shouldPreferLocal,
} from '../lib/bartclickerOffline';
import type {
  BartclickerGameState,
  ShopItem,
  Buff,
  Debuff,
  Relic,
} from '../types/bartclicker';

// Maximale Anzahl Offline-Verdienst-Upgrades
export const MAX_OFFLINE_UPGRADES = 8;
// Maximale Offline-Dauer (8 Stunden in Sekunden)
const MAX_OFFLINE_SECONDS = 8 * 3600;
// Basiskosten für das erste Rebirth (verdoppelt sich mit jedem Rebirth)
export const BASE_REBIRTH_COST = 1_000_000;

// Rebirth-Multiplikator ist die einzige Quelle der Wahrheit: er wird nie persistiert,
// sondern immer aus rebirth_count abgeleitet. Rebirths, die für Shop-Items ausgegeben
// werden (Autobuyer, Offline-Upgrades), senken rebirth_count und damit auch den Multiplikator.
function deriveRebirthMultiplier(rebirthCount: number): number {
  return Math.pow(2, rebirthCount);
}

// Eigenständige CPS-Berechnung ohne React-State – nötig, weil der Offline-Verdienst
// schon vor dem ersten Render aus den geladenen Rohdaten bestimmt werden muss.
function calculateCpsFromData(
  shopItems: ShopItem[],
  rebirthCount: number,
  relics: Relic[],
): number {
  const rebirthMultiplier = deriveRebirthMultiplier(rebirthCount);
  let totalCps = shopItems.reduce((sum, item) => {
    if (item.type === 'passive' && item.cps) {
      return sum + item.cps * item.count * rebirthMultiplier;
    }
    return sum;
  }, 0);

  relics.forEach((relic) => {
    if (relic.effect === 'cpsBonus' || relic.effect === 'allBonus') {
      const bonus = relic.cpsValue || relic.value || 0;
      totalCps *= 1 + bonus;
    }
  });

  return Math.max(0, totalCps);
}

// Passive Shop-Item-Preise skalieren mit rebirth_count. Muss immer dann neu berechnet
// werden, wenn Rebirths ausgegeben werden, ohne dass ein echter Rebirth stattfindet.
function recalculatePassiveShopItemCosts(shopItems: ShopItem[], rebirthCount: number): ShopItem[] {
  return shopItems.map((item) => {
    if (item.type === 'passive') {
      const baseCost = BASE_SHOP_ITEM_COSTS[item.id] ?? item.cost;
      return {
        ...item,
        cost: Math.floor(baseCost * Math.pow(1.1, rebirthCount)),
      };
    }
    return item;
  });
}

// Basispreise für Shop-Items (id -> cost)
const BASE_SHOP_ITEM_COSTS: { [id: number]: number } = {
  0: 15,
  1: 100,
  2: 500,
  3: 2500,
  4: 12000,
  5: 60000,
  6: 250000,
  7: 50,
  8: 500,
  9: 5000,
  10: 50000,
  11: 12500000,
  12: 50000000,
  13: 5000000,
  14: 20000000,
  15: 100000000,
};

// Initiale Shop-Items
const INITIAL_SHOP_ITEMS: ShopItem[] = [
  { id: 0, name: 'Bart-Kamm', cost: 15, cps: 0.1, icon: '🪮', type: 'passive', count: 0 },
  { id: 1, name: 'WLAN-Bartöl', cost: 100, cps: 1, icon: '💧', type: 'passive', count: 0 },
  { id: 2, name: 'Energy Drink', cost: 500, cps: 4, icon: '⚡', type: 'passive', count: 0 },
  { id: 3, name: 'Loot-Lama', cost: 2500, cps: 12, icon: '🦙', type: 'passive', count: 0 },
  { id: 4, name: 'Sektenschwur', cost: 12000, cps: 45, icon: '🐑', type: 'passive', count: 0 },
  { id: 5, name: 'Dampf-Pflege', cost: 60000, cps: 180, icon: '⚙️', type: 'passive', count: 0 },
  { id: 6, name: 'Bart-Fabrik', cost: 250000, cps: 800, icon: '🏭', type: 'passive', count: 0 },
  { id: 7, name: 'Starker Griff', cost: 50, clickPower: 1, icon: '💪', type: 'click', count: 0 },
  { id: 8, name: 'Bart-Verstärker', cost: 500, clickPower: 5, icon: '🔥', type: 'click', count: 0 },
  { id: 9, name: 'Mega-Klicker', cost: 5000, clickPower: 25, icon: '⚡', type: 'click', count: 0 },
  { id: 10, name: 'Göttlicher Touch', cost: 50000, clickPower: 100, icon: '✨', type: 'click', count: 0 },
  { id: 11, name: 'Bart-Imperium', cost: 12500000, cps: 3500, icon: '🏰', type: 'passive', count: 0 },
  { id: 12, name: 'Kosmische Bartmine', cost: 50000000, cps: 18000, icon: '🌌', type: 'passive', count: 0 },
  { id: 13, name: 'Ultimativer Klick', cost: 5000000, clickPower: 500, icon: '💫', type: 'click', count: 0 },
  { id: 14, name: 'Dimensionale Hand', cost: 20000000, clickPower: 2500, icon: '🌀', type: 'click', count: 0 },
  { id: 15, name: 'Unendlicher Bart-Reaktor', cost: 100000000, cps: 100000, icon: '⚛️', type: 'passive', count: 0 },
];

const AVAILABLE_BUFFS: Buff[] = [
  {
    id: 0,
    name: 'Turbo-Boost',
    icon: '⚡',
    effect: 'cpsMultiplier',
    value: 2,
    duration: 60000,
    baseCost: 1000,
    description: '2x CPS für 1 Minute',
    negativeEffect: {
      chance: 0.2,
      type: 'energyLoss',
      cpsValue: 0.3,
      duration: 30000,
      description: '-30% CPS für 30s',
    },
  },
  {
    id: 1,
    name: 'Klick-Wahnsinn',
    icon: '💪',
    effect: 'clickMultiplier',
    value: 3,
    duration: 45000,
    baseCost: 1500,
    description: '3x Klick-Power für 45s',
    negativeEffect: {
      chance: 0.2,
      type: 'clickReduction',
      clickValue: 0.3,
      duration: 22000,
      description: '-30% Klick-Power für 22s',
    },
  },
  {
    id: 2,
    name: 'Glücksbonus',
    icon: '🍀',
    effect: 'both',
    cpsValue: 1.5,
    clickValue: 1.5,
    duration: 30000,
    baseCost: 2000,
    description: '+50% CPS und Klicks für 30s',
    negativeEffect: {
      chance: 0.2,
      type: 'both',
      cpsValue: 0.2,
      clickValue: 0.2,
      duration: 15000,
      description: '-20% CPS und Klicks für 15s',
    },
  },
];

const AVAILABLE_RELICS = [
  { id: 0, name: 'Antiker Kamm', icon: '🏺', effect: 'cpsBonus' as const, cpsValue: 0.1, unlockCost: 25000000, description: '+10% CPS dauerhaft' },
  { id: 1, name: 'Magisches Bartöl', icon: '🧪', effect: 'clickBonus' as const, clickValue: 0.15, unlockCost: 50000000, description: '+15% Klick-Power dauerhaft' },
  { id: 2, name: 'Goldener Bart', icon: '✨', effect: 'allBonus' as const, value: 0.25, unlockCost: 100000000, description: '+25% auf alles dauerhaft' },
  { id: 3, name: 'Zeitreisendes Bartöl', icon: '⏳', effect: 'offlineBonus' as const, value: 0.5, unlockCost: 200000000, description: '+50% Offline-Verdienst' },
];

// Rohform eines gespeicherten Spielstands: Server-Zeile (numeric-Spalten kommen als
// String) oder lokaler Snapshot (Zahlen).
type StoredGameState = Omit<BartclickerGameState, 'energy' | 'total_ever'> & {
  energy: number | string;
  total_ever: number | string;
};

/** Lädt einen Spielstand über die validierende RPC hoch.
 *  'ok' = gespeichert, 'rejected' = Server lehnt ab, 'failed' = Netz/Auth-Fehler. */
async function pushStateToServer(state: BartclickerGameState): Promise<'ok' | 'rejected' | 'failed'> {
  const { data, error } = await supabase.rpc('save_bartclicker_state', {
    p_energy: state.energy,
    p_total_ever: state.total_ever,
    p_rebirth_count: state.rebirth_count,
    p_shop_items: state.shop_items,
    p_active_buffs: state.active_buffs,
    p_active_debuffs: state.active_debuffs,
    p_relics: state.relics,
    p_offline_earning_upgrades: state.offline_earning_upgrades,
    p_auto_click_buyer_enabled: state.auto_click_buyer_enabled,
    p_auto_click_buyer_unlocked: state.auto_click_buyer_unlocked,
    p_click_upgrade_buyer_enabled: state.click_upgrade_buyer_enabled,
    p_click_upgrade_buyer_unlocked: state.click_upgrade_buyer_unlocked,
    p_click_upgrade_buyer_items: state.click_upgrade_buyer_items,
  });

  if (error) {
    console.error('Error saving game state:', error);
    return 'failed';
  }
  const result = data as { success?: boolean; clamped?: boolean; error?: string } | null;
  if (result?.error) {
    console.error('Game state rejected by server:', result.error);
    return 'rejected';
  }
  if (result?.clamped) {
    console.warn('Game state growth was clamped by server validation.');
  }
  return 'ok';
}

/** Verwaltet den kompletten Bartclicker-Spielstand: Klicks, CPS, Shop, Buffs, Rebirths,
 *  Offline-Verdienst und Persistierung gegen Supabase. */
export function useBartclickerGame() {
  const { user } = useAuth();
  const userId = user?.id;

  const [gameState, setGameState] = useState<BartclickerGameState>({
    energy: 0,
    total_ever: 0,
    rebirth_count: 0,
    rebirth_multiplier: 1,
    shop_items: INITIAL_SHOP_ITEMS,
    active_buffs: [],
    active_debuffs: [],
    relics: [],
    offline_earning_upgrades: 0,
    auto_click_buyer_enabled: false,
    click_upgrade_buyer_enabled: false,
    click_upgrade_buyer_items: [],
    auto_click_buyer_unlocked: false,
    click_upgrade_buyer_unlocked: false,
  });

  // Hand-CPS-Statistiken (nur manuelle Klicks, getrennt vom Autoclicker)
  const [handCps, setHandCps] = useState(0);
  const [handCpsAvg, setHandCpsAvg] = useState(0);
  const [handCpsTop, setHandCpsTop] = useState(0);
  const handClickCountRef = useRef(0);
  const handClickStartRef = useRef<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const lastSaveTimeRef = useRef(0);
  const [offlineEarnings, setOfflineEarnings] = useState<{ amount: number; seconds: number } | null>(null);
  const [clickBlocked, setClickBlocked] = useState(false);
  const gameLoopRef = useRef<ReturnType<typeof setInterval> | null>(null);
      // Auto-Upgrade-Checkboxen kommunizieren per CustomEvent statt Props,
      // weil die Checkbox-UI tief in unabhängigen Komponenten sitzt.
      useEffect(() => {
        function handleToggleAutoUpgradeItem(e: Event) {
          const detail = (e as CustomEvent).detail;
          if (!detail || typeof detail.itemId !== 'number' || typeof detail.checked !== 'boolean') return;
          setGameState(prev => {
            const items = prev.click_upgrade_buyer_items || [];
            if (detail.checked) {
              if (items.includes(detail.itemId)) return prev;
              return { ...prev, click_upgrade_buyer_items: [...items, detail.itemId] };
            } else {
              if (!items.includes(detail.itemId)) return prev;
              return { ...prev, click_upgrade_buyer_items: items.filter(id => id !== detail.itemId) };
            }
          });
        }
        window.addEventListener('toggleAutoUpgradeItem', handleToggleAutoUpgradeItem);
        return () => {
          window.removeEventListener('toggleAutoUpgradeItem', handleToggleAutoUpgradeItem);
        };
      }, []);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isLoadingRef = useRef(false);
  // true, solange auf einem lokalen (noch nicht abgeglichenen) Offline-Stand gespielt wird
  const offlineSessionRef = useRef(false);
  const lastRejectReloadRef = useRef(0);

  // ── Anti-Autoclicker ──
  // Speichert Timestamps der letzten Klicks für Rate-Limiting und Regelmäßigkeitserkennung
  const clickTimestampsRef = useRef<number[]>([]);
  const penaltyUntilRef = useRef<number>(0);        // Unix-Timestamp bis wann Klicks gesperrt sind
  const AC_WINDOW = 20;          // Anzahl Klicks im Analyse-Fenster
  const AC_MAX_CPS = 25;         // Max erlaubte Klicks pro Sekunde
  const AC_MIN_STD_DEV = 3;      // Min Standardabweichung (ms) der Intervalle – zu gleichmäßig = Bot
  const AC_PENALTY_MS = 15000;  // Sperre in ms bei Erkennung

  const calculateCps = useCallback((): number => {
    const rebirthMult = deriveRebirthMultiplier(gameState.rebirth_count);
    let totalCps = gameState.shop_items.reduce((sum, item) => {
      if (item.type === 'passive' && item.cps) {
        return sum + item.cps * item.count * rebirthMult;
      }
      return sum;
    }, 0);

    gameState.relics.forEach((relic) => {
      if (relic.effect === 'cpsBonus' || relic.effect === 'allBonus') {
        const bonus = relic.cpsValue || relic.value || 0;
        totalCps *= 1 + bonus;
      }
    });

    gameState.active_buffs.forEach((buff) => {
      if (buff.effect === 'cpsMultiplier' || buff.effect === 'both') {
        totalCps *= buff.value || buff.cpsValue || 1;
      }
    });

    gameState.active_debuffs.forEach((debuff) => {
      if (debuff.type === 'both' || debuff.type === 'energyLoss') {
        totalCps *= 1 - (debuff.cpsValue || debuff.value || 0);
      }
    });

    return Math.max(0, totalCps);
  }, [gameState]);

  const cps = useMemo(() => calculateCps(), [calculateCps]);

  const calculateClickPower = useCallback((): number => {
    const rebirthMult = deriveRebirthMultiplier(gameState.rebirth_count);
    let power = gameState.shop_items.reduce((sum, item) => {
      if (item.type === 'click' && item.clickPower) {
        return sum + item.clickPower * item.count * rebirthMult;
      }
      return sum;
    }, 0);

    gameState.relics.forEach((relic) => {
      if (relic.effect === 'clickBonus' || relic.effect === 'allBonus') {
        const bonus = relic.clickValue || relic.value || 0;
        power *= 1 + bonus;
      }
    });

    gameState.active_buffs.forEach((buff) => {
      if (buff.effect === 'clickMultiplier' || buff.effect === 'both') {
        power *= buff.value || buff.clickValue || 1;
      }
    });

    gameState.active_debuffs.forEach((debuff) => {
      if (debuff.type === 'both' || debuff.type === 'clickReduction') {
        power *= 1 - (debuff.clickValue || debuff.value || 0);
      }
    });

    return Math.max(1, power);
  }, [gameState]);

  // Rohdaten (Server-Zeile oder lokaler Snapshot) in den Spielstand übernehmen und
  // den Offline-Verdienst seit lastActiveMs gutschreiben.
  const applyLoadedState = useCallback((data: StoredGameState, lastActiveMs: number | null) => {
    let offlineEarningsAmount = 0;
    let offlineEarningsSeconds = 0;
    if (lastActiveMs) {
      offlineEarningsSeconds = Math.min((Date.now() - lastActiveMs) / 1000, MAX_OFFLINE_SECONDS);

      // Unter einer Minute Abwesenheit gibt es keinen Offline-Verdienst
      if (offlineEarningsSeconds > 60) {
        const savedCps = calculateCpsFromData(
          (data.shop_items || []) as ShopItem[],
          data.rebirth_count || 0,
          (data.relics || []) as Relic[],
        );

        // Basis-Offline-Rate: 10 % des Online-CPS, +10 % je Offline-Upgrade
        let offlineMultiplier = 0.1;
        offlineMultiplier += (data.offline_earning_upgrades || 0) * 0.1;
        (data.relics as Relic[] || []).forEach((relic) => {
          if (relic.effect === 'offlineBonus') {
            offlineMultiplier += relic.value || 0;
          }
        });

        offlineEarningsAmount = Math.floor(savedCps * offlineEarningsSeconds * offlineMultiplier);
      }
    }

    setGameState({
      id: data.id,
      user_id: data.user_id,
      energy: (parseFloat(String(data.energy)) || 0) + offlineEarningsAmount,
      total_ever: (parseFloat(String(data.total_ever)) || 0) + offlineEarningsAmount,
      rebirth_count: data.rebirth_count || 0,
      rebirth_multiplier: deriveRebirthMultiplier(data.rebirth_count || 0),
      shop_items: (data.shop_items || []).map((item: ShopItem) => ({
        ...item,
        cost: item.cost || INITIAL_SHOP_ITEMS.find(i => i.id === item.id)?.cost || 0,
      })),
      active_buffs: (data.active_buffs || []).filter((buff: Buff) => buff.endTime && buff.endTime > Date.now()),
      active_debuffs: (data.active_debuffs || []).filter((debuff: { endTime: number }) => debuff.endTime && debuff.endTime > Date.now()),
      relics: data.relics || [],
      offline_earning_upgrades: data.offline_earning_upgrades || 0,
      auto_click_buyer_enabled: data.auto_click_buyer_enabled || false,
      click_upgrade_buyer_enabled: data.click_upgrade_buyer_enabled || false,
      click_upgrade_buyer_items: data.click_upgrade_buyer_items || [],
      auto_click_buyer_unlocked: data.auto_click_buyer_unlocked || false,
      click_upgrade_buyer_unlocked: data.click_upgrade_buyer_unlocked || false,
      last_updated: data.last_updated,
      created_at: data.created_at,
    });

    if (offlineEarningsAmount > 0) {
      setOfflineEarnings({
        amount: offlineEarningsAmount,
        seconds: Math.floor(offlineEarningsSeconds),
      });
    }
  }, []);

  const loadGameState = useCallback(async () => {
    if (!userId) {
      return;
    }

    // Parallele Loads würden sich gegenseitig State überschreiben
    if (isLoadingRef.current) {
      return;
    }

    isLoadingRef.current = true;

    // Alten Request abbrechen, damit ein veraltetes Ergebnis nicht den neuen State überschreibt
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    // Lokaler Snapshot: Grundlage fürs Offline-Spielen und Quelle für noch nicht
    // hochgeladenen Fortschritt.
    const local = readGameSnapshot(userId);

    try {
      setIsLoading(true);

      let data: StoredGameState | null = null;
      let error: { code?: string; message?: string } | null = null;
      if (isOffline()) {
        error = { message: 'offline' };
      } else {
        const result = await supabase
          .from('bartclicker_scores')
          .select('*')
          .eq('user_id', userId)
          .single();
        data = result.data as StoredGameState | null;
        error = result.error;
      }

      if (signal.aborted) {
        isLoadingRef.current = false;
        return;
      }

      if (error) {
        // PGRST116 = keine Zeile gefunden, erwartet für neue Nutzer ohne Spielstand
        if (error.code === 'PGRST116') {
          const initialState: BartclickerGameState = {
            user_id: userId,
            energy: 0,
            total_ever: 0,
            rebirth_count: 0,
            rebirth_multiplier: 1,
            shop_items: INITIAL_SHOP_ITEMS,
            active_buffs: [],
            active_debuffs: [],
            relics: [],
            offline_earning_upgrades: 0,
            auto_click_buyer_enabled: false,
            click_upgrade_buyer_enabled: false,
            click_upgrade_buyer_items: [],
            auto_click_buyer_unlocked: false,
            click_upgrade_buyer_unlocked: false,
          };

          // State wird unten unabhängig gesetzt; ein fehlgeschlagener Save ist nicht fatal,
          // da der initiale Spielstand beim nächsten Save erneut persistiert wird.
          // Schreiben läuft über die validierende RPC (Anti-Cheat) — direkte
          // Inserts auf bartclicker_scores sind per RLS gesperrt.
          try {
            await pushStateToServer(initialState);
          } catch (upsertErr) {
            console.error('Failed to create initial game state:', upsertErr);
          }

          if (!signal.aborted) {
            writeGameSnapshot(userId, initialState, false);
            setGameState(initialState);
          }
        } else if (local) {
          // Offline bzw. Server nicht erreichbar: mit dem lokalen Stand weiterspielen.
          // Er bleibt "dirty" und wird beim nächsten erfolgreichen Save hochgeladen.
          console.warn('Bartclicker: Server nicht erreichbar, nutze lokalen Spielstand.', error);
          if (!signal.aborted) {
            applyLoadedState(local.state, local.savedAt);
            offlineSessionRef.current = true;
          }
        } else {
          // Andere Fehler (RLS, Netzwerk) ohne lokalen Stand: State NICHT setzen, damit
          // kein leerer Spielstand einen vorhandenen überschreibt.
          console.error('Error loading game state:', error);

          if (!signal.aborted) {
            setIsLoading(false);
          }
        }
      } else if (data) {
        // Leeres data-Objekt würde einen echten Spielstand zerstören – darum der Längen-Check
        if (!signal.aborted && data && Object.keys(data).length > 0) {
          if (local && shouldPreferLocal(local, data)) {
            // Offline erspielter Fortschritt ist neuer als der Server → lokal übernehmen
            // und sofort hochladen.
            applyLoadedState({ ...local.state, id: data.id, user_id: data.user_id }, local.savedAt);
            void pushStateToServer(local.state).then((outcome) => {
              if (outcome === 'ok' || outcome === 'rejected') markGameSnapshotSynced(userId, local.savedAt);
            });
          } else {
            applyLoadedState(data, data.last_updated ? new Date(data.last_updated).getTime() : null);
            // numeric-Spalten kommen als String → als Zahl sichern, sonst vergleicht
            // shouldPreferLocal später Strings
            writeGameSnapshot(userId, {
              ...(data as BartclickerGameState),
              energy: parseFloat(String(data.energy)) || 0,
              total_ever: parseFloat(String(data.total_ever)) || 0,
            }, false);
          }
          offlineSessionRef.current = false;
        }
      }
    } catch (err) {
      // Netzwerk-Exception: falls vorhanden mit lokalem Stand weiterspielen,
      // sonst State unverändert lassen, um keinen Spielstand zu verlieren.
      console.error('Failed to load game state:', err);
      if (local && !signal.aborted) {
        applyLoadedState(local.state, local.savedAt);
        offlineSessionRef.current = true;
      }
    } finally {
      if (!signal.aborted) {
        setIsLoading(false);
      }
      isLoadingRef.current = false;
    }
  }, [userId, applyLoadedState]);

  // Aktuellen Spielstand für Event-Handler (visibilitychange, online) griffbereit halten
  const gameStateRef = useRef(gameState);
  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  // Sichert den Spielstand lokal (Offline-Fallback). Liefert den Zeitstempel oder null.
  const persistLocally = useCallback((): number | null => {
    const state = gameStateRef.current;
    if (!userId || isLoadingRef.current || state.user_id !== userId) return null;
    return writeGameSnapshot(userId, state, true);
  }, [userId]);

  const saveGameState = useCallback(async () => {
    if (!userId) {
      return;
    }

    // Speichern während eines laufenden Loads würde den noch nicht geladenen
    // (leeren) State persistieren und den echten Spielstand überschreiben
    if (isLoadingRef.current) {
      return;
    }

    try {
      // Fehlende user_id bedeutet: State ist noch nicht initialisiert – nicht speichern
      if (!gameState.user_id) {
        return;
      }

      // Immer zuerst lokal sichern — offline ist das der einzige Speicherort.
      const savedAt = writeGameSnapshot(userId, gameState, true);
      if (isOffline()) {
        return;
      }

      // Anti-Cheat: Speichern läuft über die serverseitig validierende RPC
      // (Monotonie, Bezahlbarkeit, Wachstumsgrenze) — direkte Upserts auf
      // bartclicker_scores sind per RLS gesperrt. last_updated setzt der Server.
      const outcome = await pushStateToServer(gameState);
      if (outcome === 'ok') {
        markGameSnapshotSynced(userId, savedAt);
        if (offlineSessionRef.current) {
          offlineSessionRef.current = false;
        }
      } else if (outcome === 'rejected') {
        // Server lehnt den Stand ab (z. B. auf anderem Gerät weitergespielt) → nicht
        // endlos erneut senden, sondern den Server-Stand neu laden.
        markGameSnapshotSynced(userId, savedAt);
        if (Date.now() - lastRejectReloadRef.current > 60_000) {
          lastRejectReloadRef.current = Date.now();
          void loadGameState();
        }
      }
    } catch (err) {
      console.error('Failed to save game state:', err);
    }
  }, [userId, gameState, loadGameState]);

  // isAutoClick=true umgeht die Anti-Autoclicker-Prüfung – der eigene Autobuyer
  // soll nicht als Cheat erkannt werden.
  const handleClick = useCallback((isAutoClick = false) => {
    const now = performance.now();

    if (!isAutoClick) {
      // Während einer aktiven Sperre Klicks stillschweigend verwerfen
      if (penaltyUntilRef.current > Date.now()) {
        return;
      }

      const timestamps = clickTimestampsRef.current;
      timestamps.push(now);

      handClickCountRef.current++;
      if (!handClickStartRef.current) handClickStartRef.current = now;

      if (timestamps.length > AC_WINDOW) {
        timestamps.splice(0, timestamps.length - AC_WINDOW);
      }

      // Mindestens 6 Klicks für eine sinnvolle Analyse
      if (timestamps.length >= 6) {
        const windowStart = timestamps[0];
        const windowEnd = timestamps[timestamps.length - 1];
        const windowDuration = (windowEnd - windowStart) / 1000;

        // Erkennung 1: zu hohe Klickrate
        if (windowDuration > 0) {
          const clicksPerSecond = (timestamps.length - 1) / windowDuration;
          if (clicksPerSecond > AC_MAX_CPS) {
            penaltyUntilRef.current = Date.now() + AC_PENALTY_MS;
            clickTimestampsRef.current = [];
            setClickBlocked(true);
            setTimeout(() => setClickBlocked(false), AC_PENALTY_MS);
            console.warn('Autoclicker erkannt: Klickrate zu hoch (' + clicksPerSecond.toFixed(1) + ' CPS)');
            return;
          }
        }

        // Erkennung 2: zu gleichmäßige Intervalle (menschliche Klicks streuen)
        if (timestamps.length >= AC_WINDOW) {
          const intervals: number[] = [];
          for (let i = 1; i < timestamps.length; i++) {
            intervals.push(timestamps[i] - timestamps[i - 1]);
          }
          const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
          const variance = intervals.reduce((sum, iv) => sum + Math.pow(iv - mean, 2), 0) / intervals.length;
          const stdDev = Math.sqrt(variance);

          // Nur sperren, wenn die Klicks gleichzeitig sehr regelmäßig UND schnell sind
          if (stdDev < AC_MIN_STD_DEV && mean < 200) {
            penaltyUntilRef.current = Date.now() + AC_PENALTY_MS;
            clickTimestampsRef.current = [];
            setClickBlocked(true);
            setTimeout(() => setClickBlocked(false), AC_PENALTY_MS);
            console.warn('Autoclicker erkannt: Zu gleichmäßige Intervalle (σ=' + stdDev.toFixed(2) + 'ms, μ=' + mean.toFixed(1) + 'ms)');
            return;
          }
        }
      }
    }

    const power = calculateClickPower();

    setGameState((prev) => ({
      ...prev,
      energy: prev.energy + power,
      total_ever: prev.total_ever + power,
    }));
  }, [calculateClickPower]);
  // Auto-Klicker-Loop: 10 Klicks pro Sekunde, solange der Autobuyer aktiviert ist
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    if (gameState.auto_click_buyer_enabled) {
      interval = setInterval(() => {
        handleClick(true);
      }, 100);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [gameState.auto_click_buyer_enabled, handleClick]);

  // Upgrade-Buyer-Loop: kauft automatisch die in click_upgrade_buyer_items markierten Items
  useEffect(() => {
    if (!gameState.click_upgrade_buyer_enabled) return;
    const interval = setInterval(() => {
      setGameState((prev) => {
        let newState = { ...prev };
        (prev.click_upgrade_buyer_items || []).forEach((itemId) => {
          const item = newState.shop_items.find((i) => i.id === itemId);
          if (!item) return;
          if (newState.energy >= item.cost) {
            newState = {
              ...newState,
              energy: newState.energy - item.cost,
              shop_items: newState.shop_items.map((i) =>
                i.id === itemId
                  ? { ...i, count: i.count + 1, cost: Math.floor(i.cost * 1.15) }
                  : i
              ),
            };
          }
        });
        return newState;
      });
    }, 500);
    return () => clearInterval(interval);
  }, [gameState.click_upgrade_buyer_enabled]);

  // item.cost ist bereits der aktuelle, rebirth-skalierte Preis
  const buyItem = useCallback(
    (itemId: number) => {
      const item = gameState.shop_items.find((i) => i.id === itemId);
      if (!item || gameState.energy < item.cost) return false;

      setGameState((prev) => ({
        ...prev,
        energy: prev.energy - item.cost,
        shop_items: prev.shop_items.map((i) =>
          i.id === itemId 
            ? { 
                ...i, 
                count: i.count + 1, 
                cost: Math.floor(i.cost * 1.15)
              }
            : i
        ),
      }));

      return true;
    },
    [gameState.energy, gameState.shop_items]
  );

  // Kauft so viele Einheiten eines Items, wie die aktuelle Energie hergibt.
  // Jeder Kauf erhöht den Preis um 15 %, daher die zweistufige Berechnung.
  const buyMaxItems = useCallback(
    (itemId: number) => {
      const item = gameState.shop_items.find((i) => i.id === itemId);
      if (!item) return false;

      let nextCost = item.cost;
      let currentEnergy = gameState.energy;
      let count = 0;

      // Erst ermitteln, wie viele Einheiten leistbar sind
      while (currentEnergy >= nextCost) {
        currentEnergy -= nextCost;
        count++;
        nextCost = Math.floor(nextCost * 1.15);
      }

      if (count === 0) return false;

      // Dann Gesamtkosten und Endpreis für genau diese Anzahl bestimmen
      let energyUsed = 0;
      let cost = item.cost;
      for (let i = 0; i < count; i++) {
        energyUsed += cost;
        cost = Math.floor(cost * 1.15);
      }

      setGameState((prev) => ({
        ...prev,
        energy: prev.energy - energyUsed,
        shop_items: prev.shop_items.map((i) =>
          i.id === itemId 
            ? { 
                ...i, 
                count: i.count + count, 
                cost: cost
              }
            : i
        ),
      }));

      return true;
    },
    [gameState.energy, gameState.shop_items]
  );

  const activateBuff = useCallback(
    (buffId: number) => {
      const buff = AVAILABLE_BUFFS.find((b) => b.id === buffId);
      if (!buff) return false;

      const cost = buff.baseCost * Math.pow(2, gameState.rebirth_count);
      if (gameState.energy < cost) return false;

      const endTime = Date.now() + buff.duration;

      // Jeder Buff kann per Zufall einen negativen Nebeneffekt (Debuff) auslösen
      const newDebuffs: Debuff[] = [];
      if (buff.negativeEffect && Math.random() < buff.negativeEffect.chance) {
        const debuffEndTime = Date.now() + (buff.negativeEffect.duration ?? buff.duration);
        newDebuffs.push({
          type: buff.negativeEffect.type,
          ...(buff.negativeEffect.value !== undefined && { value: buff.negativeEffect.value }),
          cpsValue: buff.negativeEffect.cpsValue,
          clickValue: buff.negativeEffect.clickValue,
          endTime: debuffEndTime,
          description: buff.negativeEffect.description,
        });
      }

      setGameState((prev) => ({
        ...prev,
        energy: prev.energy - cost,
        active_buffs: [
          ...prev.active_buffs,
          {
            ...buff,
            endTime,
          },
        ],
        active_debuffs: [
          ...prev.active_debuffs,
          ...newDebuffs,
        ],
      }));

      return true;
    },
    [gameState.energy, gameState.rebirth_count]
  );

  // Rebirth: erhöht den Multiplikator, setzt Energie und gekaufte Items zurück,
  // behält aber Relikte und Autobuyer-Freischaltungen.
  const performRebirth = useCallback(() => {
    setGameState((prev) => {
      const rebirthCost = BASE_REBIRTH_COST * Math.pow(2, prev.rebirth_count);
      if (prev.energy < rebirthCost) return prev;
      const newRebirthCount = prev.rebirth_count + 1;
      return {
        ...prev,
        rebirth_count: newRebirthCount,
        rebirth_multiplier: deriveRebirthMultiplier(newRebirthCount),
        energy: 0,
        shop_items: prev.shop_items.map((item) => ({
          ...item,
          count: 0,
          cost: Math.floor((INITIAL_SHOP_ITEMS.find((i) => i.id === item.id)?.cost || item.cost) * Math.pow(1.1, newRebirthCount)),
        })),
        active_buffs: [],
        active_debuffs: [],
        auto_click_buyer_enabled: prev.auto_click_buyer_enabled,
        auto_click_buyer_unlocked: prev.auto_click_buyer_unlocked,
      };
    });
  }, []);

  // CPS-Loop: schreibt den passiven Verdienst alle 100 ms gutschreibt (cps / 10 pro Tick)
  useEffect(() => {
    if (gameLoopRef.current) clearInterval(gameLoopRef.current);

    gameLoopRef.current = setInterval(() => {
      setGameState((prev) => ({
        ...prev,
        energy: prev.energy + cps / 10,
        total_ever: prev.total_ever + cps / 10,
      }));
    }, 100);

    return () => {
      if (gameLoopRef.current) clearInterval(gameLoopRef.current);
    };
  }, [cps]);

  // Abgelaufene Buffs und Debuffs jede Sekunde bereinigen
  useEffect(() => {
    const cleanupInterval = setInterval(() => {
      const now = Date.now();
      setGameState((prev) => {
        const filteredBuffs = prev.active_buffs.filter((buff) => buff.endTime && buff.endTime > now);
        const filteredDebuffs = prev.active_debuffs.filter((debuff) => debuff.endTime > now);
        if (filteredBuffs.length === prev.active_buffs.length && filteredDebuffs.length === prev.active_debuffs.length) {
          return prev;
        }
        return {
          ...prev,
          active_buffs: filteredBuffs,
          active_debuffs: filteredDebuffs,
        };
      });
    }, 1000);

    return () => clearInterval(cleanupInterval);
  }, []);

  // setTimeout(0) verschiebt den ersten Load hinter den Render, damit nicht
  // gleichzeitig gerendert und State gesetzt wird.
  useEffect(() => {
    if (!userId) return;
    const timeout = setTimeout(() => {
      void loadGameState();
    }, 0);
    return () => clearTimeout(timeout);
  }, [loadGameState, userId]);

  // Lokale Sicherung alle 2 Sekunden, damit beim Schließen der App offline
  // praktisch kein Fortschritt verloren geht.
  useEffect(() => {
    const interval = setInterval(() => {
      persistLocally();
    }, 2000);
    return () => clearInterval(interval);
  }, [persistLocally]);

  // App geht in den Hintergrund / Tab wird geschlossen → sofort sichern
  const saveGameStateRef = useRef(saveGameState);
  useEffect(() => {
    saveGameStateRef.current = saveGameState;
  }, [saveGameState]);
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') {
        persistLocally();
        void saveGameStateRef.current();
      }
    };
    const onPageHide = () => persistLocally();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [persistLocally]);

  // Wieder online → lokalen Stand sichern und mit dem Server abgleichen
  // (loadGameState bevorzugt den lokalen Stand und lädt ihn hoch, wenn er neuer ist).
  useEffect(() => {
    const onOnline = () => {
      persistLocally();
      void loadGameState();
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [persistLocally, loadGameState]);

  // Periodisches Auto-Save alle 10 Sekunden
  useEffect(() => {
    const saveInterval = setInterval(() => {
      saveGameState();
    }, 10000);

    return () => clearInterval(saveInterval);
  }, [saveGameState]);

  // Zusätzlich sofort speichern bei wichtigen Änderungen (Rebirth, Käufe).
  // Summe der item.count statt .length, weil sich nur die Anzahl ändert, nicht die Item-Liste.
  // Das 5-Sekunden-Throttle verhindert Speicher-Spam bei schnellen Käufen.
  const totalShopCount = gameState.shop_items.reduce((sum, item) => sum + item.count, 0);
  useEffect(() => {
    const now = Date.now();
    if (now - lastSaveTimeRef.current > 5000) {
      saveGameState();
      lastSaveTimeRef.current = now;
    }
  }, [gameState.rebirth_count, totalShopCount, gameState.offline_earning_upgrades, saveGameState]);

  // Autobuyer wird einmalig für 10 Rebirths freigeschaltet; danach nur noch kostenloses Toggle.
  const buyAutobuyer = useCallback(() => {
    if (!gameState.auto_click_buyer_unlocked) {
      if (gameState.rebirth_count < 10) return false;
      setGameState((prev) => {
        const newRebirthCount = prev.rebirth_count - 10;
        return {
          ...prev,
          rebirth_count: newRebirthCount,
          rebirth_multiplier: deriveRebirthMultiplier(newRebirthCount),
          auto_click_buyer_enabled: true,
          auto_click_buyer_unlocked: true,
          shop_items: recalculatePassiveShopItemCosts(prev.shop_items, newRebirthCount),
        };
      });
      return true;
    } else {
      setGameState((prev) => ({
        ...prev,
        auto_click_buyer_enabled: !prev.auto_click_buyer_enabled,
      }));
      return true;
    }
  }, [gameState.rebirth_count, gameState.auto_click_buyer_unlocked]);

  // Upgrade-Autobuyer: einmalig für 10 Rebirths freischalten, danach kostenloses Toggle.
  const buyUpgradeAutobuyer = useCallback(() => {
    if (!gameState.click_upgrade_buyer_unlocked) {
      if (gameState.rebirth_count < 10) return false;
      setGameState((prev) => {
        const newRebirthCount = prev.rebirth_count - 10;
        return {
          ...prev,
          rebirth_count: newRebirthCount,
          rebirth_multiplier: deriveRebirthMultiplier(newRebirthCount),
          click_upgrade_buyer_enabled: true,
          click_upgrade_buyer_unlocked: true,
          shop_items: recalculatePassiveShopItemCosts(prev.shop_items, newRebirthCount),
        };
      });
      return true;
    } else {
      setGameState((prev) => ({
        ...prev,
        click_upgrade_buyer_enabled: !prev.click_upgrade_buyer_enabled,
      }));
      return true;
    }
  }, [gameState.rebirth_count, gameState.click_upgrade_buyer_unlocked]);

  const unlockRelic = useCallback(
    (relicId: number) => {
      const relic = AVAILABLE_RELICS.find((r) => r.id === relicId);
      if (!relic || gameState.energy < relic.unlockCost) return false;
      if (gameState.relics.some((r) => r.id === relicId)) return false;

      setGameState((prev) => ({
        ...prev,
        energy: prev.energy - relic.unlockCost,
        relics: [...prev.relics, relic],
      }));

      return true;
    },
    [gameState.energy, gameState.relics]
  );

  // Kostet 5 Rebirths pro Stufe und erhöht die Offline-Verdienstrate um +10 %.
  const OFFLINE_UPGRADE_REBIRTH_COST = 5;
  const buyOfflineUpgrade = useCallback(() => {
    if (gameState.offline_earning_upgrades >= MAX_OFFLINE_UPGRADES) return false;
    if (gameState.rebirth_count < OFFLINE_UPGRADE_REBIRTH_COST) return false;


    setGameState((prev) => {
      const newRebirthCount = prev.rebirth_count - OFFLINE_UPGRADE_REBIRTH_COST;
      return {
        ...prev,
        rebirth_count: newRebirthCount,
        rebirth_multiplier: deriveRebirthMultiplier(newRebirthCount),
        offline_earning_upgrades: prev.offline_earning_upgrades + 1,
        shop_items: recalculatePassiveShopItemCosts(prev.shop_items, newRebirthCount),
      };
    });

    return true;
  }, [gameState.rebirth_count, gameState.offline_earning_upgrades]);

  const dismissOfflineEarnings = useCallback(() => {
    setOfflineEarnings(null);
  }, []);

  // Aktualisiert die Hand-CPS-Statistiken (aktuell, Durchschnitt, Spitzenwert) alle 500 ms
  useEffect(() => {
    const interval = setInterval(() => {
      const now = performance.now();
      const timestamps = clickTimestampsRef.current;
      const oneSecAgo = now - 1000;
      const recentClicks = timestamps.filter(ts => ts >= oneSecAgo);
      setHandCps(recentClicks.length);
      if (handClickStartRef.current) {
        const duration = (now - handClickStartRef.current) / 1000;
        const avg = duration > 0 ? handClickCountRef.current / duration : 0;
        setHandCpsAvg(avg);
      }
      if (recentClicks.length > handCpsTop) setHandCpsTop(recentClicks.length);
    }, 500);
    return () => clearInterval(interval);
  }, [handCpsTop]);

  return {
    gameState,
    isLoading,
    clickPower: calculateClickPower(),
    cps,
    clickBlocked,
    offlineEarnings,
    dismissOfflineEarnings,
    handleClick,
    buyItem,
    buyMaxItems,
    activateBuff,
    performRebirth,
    buyAutobuyer,
    buyUpgradeAutobuyer,
    unlockRelic,
    buyOfflineUpgrade,
    saveGameState,
    loadGameState,
    handCps,
    handCpsAvg,
    handCpsTop,
  };
}







