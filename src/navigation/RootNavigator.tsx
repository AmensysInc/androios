import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import AuthStack from './AuthStack';
import MainDrawer from './MainDrawer';
import LanguageGate from '../i18n/LanguageGate';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';

const Stack = createNativeStackNavigator();

export default function RootNavigator() {
  const { user, isLoading } = useAuth();
  const { t } = useTranslation();

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#3b82f6" />
        <Text style={styles.loadingText}>{t('common.loading')}</Text>
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!user ? (
          <Stack.Screen name="Auth" component={AuthStack} />
        ) : (
          <Stack.Screen name="Main">
            {() => (
              <LanguageGate>
                <MainDrawer />
              </LanguageGate>
            )}
          </Stack.Screen>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' },
  loadingText: { marginTop: 12, fontSize: 16, color: '#64748b' },
});
