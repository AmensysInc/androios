import React from 'react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from './LanguageProvider';
import LanguageSelectionScreen from '../screens/LanguageSelectionScreen';

type Props = {
  children: React.ReactNode;
};

/** Blocks the main app until the user picks a language on first login (matches web LanguageGate). */
export default function LanguageGate({ children }: Props) {
  const { user } = useAuth();
  const { hasStoredPreference } = useLanguage();

  if (user && !hasStoredPreference) {
    return <LanguageSelectionScreen required />;
  }

  return <>{children}</>;
}
