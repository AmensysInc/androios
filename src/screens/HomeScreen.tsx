import React, { useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useNavigation } from '@react-navigation/native';
import { getMainDrawerInitialRoute } from '../navigation/mainDrawerInitialRoute';

export default function HomeScreen() {
  const { user, role } = useAuth();
  const navigation = useNavigation<any>();

  useEffect(() => {
    if (!role) return;
    const target = getMainDrawerInitialRoute(role);
    if (target !== 'Home') navigation.replace(target);
  }, [role, navigation]);

  return (
    <View style={styles.centered}>
      <ActivityIndicator size="large" color="#3b82f6" />
      <Text style={styles.text}>Loading...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' },
  text: { marginTop: 12, fontSize: 16, color: '#64748b' },
});
