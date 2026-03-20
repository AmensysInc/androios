import React, { useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useNavigation } from '@react-navigation/native';

export default function HomeScreen() {
  const { user, role } = useAuth();
  const navigation = useNavigation<any>();

  useEffect(() => {
    if (!role) return;
    if (role === 'super_admin' || role === 'admin') {
      navigation.replace('SuperAdminDashboard');
    } else if (role === 'operations_manager') {
      navigation.replace('OrganizationDashboard');
    } else if (role === 'manager') {
      navigation.replace('CompanyDashboard');
    } else if (role === 'employee' || role === 'house_keeping' || role === 'maintenance') {
      navigation.replace('EmployeeDashboard');
    } else {
      navigation.replace('Calendar');
    }
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
