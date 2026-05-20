import React, { createContext, useContext } from 'react';
import { useMotelCleaningSession } from '../hooks/useMotelCleaningSession';

type SessionApi = ReturnType<typeof useMotelCleaningSession>;

const MotelCleaningSessionContext = createContext<SessionApi | null>(null);

export function MotelCleaningSessionProvider({ children }: { children: React.ReactNode }) {
  const session = useMotelCleaningSession();
  return (
    <MotelCleaningSessionContext.Provider value={session}>{children}</MotelCleaningSessionContext.Provider>
  );
}

export function useMotelCleaningSessionContext(): SessionApi {
  const ctx = useContext(MotelCleaningSessionContext);
  if (!ctx) {
    throw new Error('useMotelCleaningSessionContext must be used within MotelCleaningSessionProvider');
  }
  return ctx;
}
