import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { formatCleaningTimerHms } from '../lib/motelRoomDisplay';

const STORAGE_KEY = '@motel_active_cleaning_session_v1';

export type StoredMotelCleaningSession = {
  roomId: string;
  sessionId: string;
  startedAtMs: number;
};

async function readStoredSession(): Promise<StoredMotelCleaningSession | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredMotelCleaningSession;
    if (!parsed?.roomId || !parsed?.sessionId || !parsed?.startedAtMs) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeStoredSession(session: StoredMotelCleaningSession | null): Promise<void> {
  if (!session) {
    await AsyncStorage.removeItem(STORAGE_KEY);
    return;
  }
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function useMotelCleaningSession() {
  const [roomId, setRoomId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [startedAtMs, setStartedAtMs] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const recomputeElapsed = useCallback((startMs: number | null) => {
    if (!startMs) {
      setElapsedSeconds(0);
      return;
    }
    setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startMs) / 1000)));
  }, []);

  const hydrate = useCallback(async () => {
    const stored = await readStoredSession();
    if (stored) {
      setRoomId(stored.roomId);
      setSessionId(stored.sessionId);
      setStartedAtMs(stored.startedAtMs);
      recomputeElapsed(stored.startedAtMs);
    }
    setHydrated(true);
  }, [recomputeElapsed]);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (!startedAtMs) {
      if (tickRef.current) clearInterval(tickRef.current);
      tickRef.current = null;
      return;
    }
    recomputeElapsed(startedAtMs);
    tickRef.current = setInterval(() => recomputeElapsed(startedAtMs), 1000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [startedAtMs, recomputeElapsed]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active' && startedAtMs) recomputeElapsed(startedAtMs);
    });
    return () => sub.remove();
  }, [startedAtMs, recomputeElapsed]);

  const beginSession = useCallback(async (nextRoomId: string, nextSessionId: string) => {
    const startMs = Date.now();
    const stored: StoredMotelCleaningSession = {
      roomId: nextRoomId,
      sessionId: nextSessionId,
      startedAtMs: startMs,
    };
    await writeStoredSession(stored);
    setRoomId(nextRoomId);
    setSessionId(nextSessionId);
    setStartedAtMs(startMs);
    recomputeElapsed(startMs);
  }, [recomputeElapsed]);

  const clearSession = useCallback(async () => {
    await writeStoredSession(null);
    setRoomId(null);
    setSessionId(null);
    setStartedAtMs(null);
    setElapsedSeconds(0);
  }, []);

  const isActiveForRoom = useCallback(
    (id: string) => Boolean(roomId && sessionId && roomId === id),
    [roomId, sessionId]
  );

  const timerLabel = formatCleaningTimerHms(elapsedSeconds);

  return {
    roomId,
    sessionId,
    startedAtMs,
    elapsedSeconds,
    timerLabel,
    hydrated,
    beginSession,
    clearSession,
    isActiveForRoom,
    hasActiveSession: Boolean(roomId && sessionId),
  };
}
