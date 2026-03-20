import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider } from './src/context/AuthContext';
import RootNavigator from './src/navigation/RootNavigator';
import apiClient from './src/lib/api-client';

export default function App() {
  useEffect(() => {
    apiClient.getToken().catch(() => {});
  }, []);

  return (
    <>
      <StatusBar style="auto" />
      <AuthProvider>
        <RootNavigator />
      </AuthProvider>
    </>
  );
}
