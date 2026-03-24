import React from 'react';
import { createDrawerNavigator } from '@react-navigation/drawer';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { getRoleDisplayLabel } from '../types/auth';
import { getMainDrawerInitialRoute } from './mainDrawerInitialRoute';

import HomeScreen from '../screens/HomeScreen';
import SuperAdminDashboard from '../screens/SuperAdminDashboard';
import OrganizationDashboard from '../screens/OrganizationDashboard';
import CompanyDashboard from '../screens/CompanyDashboard';
import EmployeeDashboard from '../screens/EmployeeDashboard';
import CalendarScreen from '../screens/CalendarScreen';
import TasksScreen from '../screens/TasksScreen';
import FocusScreen from '../screens/FocusScreen';
import HabitsScreen from '../screens/HabitsScreen';
import UserManagementScreen from '../screens/UserManagementScreen';
import TemplateScreen from '../screens/TemplateScreen';
import AccountScreen from '../screens/AccountScreen';
import ClockInScreen from '../screens/ClockInScreen';

import CompaniesScreen from '../screens/scheduler/CompaniesScreen';
import ScheduleScreen from '../screens/scheduler/ScheduleScreen';
import EmployeesScreen from '../screens/scheduler/EmployeesScreen';
import TimeClockScreen from '../screens/scheduler/TimeClockScreen';
import EmployeeScheduleScreen from '../screens/scheduler/EmployeeScheduleScreen';
import MissedShiftsScreen from '../screens/scheduler/MissedShiftsScreen';

const Drawer = createDrawerNavigator();

function CustomDrawerContent({ navigation }: any) {
  const { user, role, signOut } = useAuth();

  const mainItems = [
    { name: 'Home', label: 'Home' },
    { name: 'Calendar', label: 'Calendar' },
    { name: 'Tasks', label: 'Tasks' },
    { name: 'Focus', label: 'Focus Hours' },
    { name: 'Habits', label: 'Daily Routines' },
  ];

  const schedulerItems = [
    { name: 'Companies', label: 'Companies' },
    { name: 'Schedule', label: 'Schedule' },
    { name: 'Employees', label: 'Employees' },
    { name: 'EmployeeSchedule', label: 'Employee Schedule' },
    { name: 'TimeClock', label: 'Time Clock' },
    { name: 'MissedShifts', label: 'Missed Shifts' },
  ];

  const managementExtra = [
    { name: 'CheckLists', label: 'Check Lists' },
    { name: 'UserManagement', label: 'User Management' },
  ];

  const isAdmin = role && ['super_admin', 'admin', 'operations_manager', 'manager'].includes(role);
  const isEmployee = role && ['employee', 'house_keeping', 'maintenance'].includes(role);

  const adminDashboard = role === 'super_admin' || role === 'admin';

  return (
    <View style={styles.drawer}>
      <ScrollView style={styles.drawerScroll} contentContainerStyle={styles.drawerScrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={styles.brandRow}>
            <Text style={styles.brandZen}>zen</Text>
            <MaterialCommunityIcons name="clock-outline" size={18} color="#0f172a" style={styles.brandIcon} />
            <Text style={styles.brandScheduler}>scheduler</Text>
          </View>
          {role && <Text style={styles.roleBadge}>{getRoleDisplayLabel(role)}</Text>}
        </View>
        <TouchableOpacity
          style={styles.menuItem}
          onPress={() =>
            adminDashboard ? navigation.navigate('SuperAdminDashboard') : navigation.navigate('Home')
          }
        >
          <Text style={styles.menuLabel}>{adminDashboard ? 'Dashboard' : 'Home'}</Text>
        </TouchableOpacity>
        {mainItems.slice(1).map((item) => (
          <TouchableOpacity key={item.name} style={styles.menuItem} onPress={() => navigation.navigate(item.name)}>
            <Text style={styles.menuLabel}>{item.label}</Text>
          </TouchableOpacity>
        ))}
        {role === 'operations_manager' && (
          <TouchableOpacity style={styles.menuItem} onPress={() => navigation.navigate('OrganizationDashboard')}>
            <Text style={styles.menuLabel}>Organization Dashboard</Text>
          </TouchableOpacity>
        )}
        {role === 'manager' && (
          <TouchableOpacity style={styles.menuItem} onPress={() => navigation.navigate('CompanyDashboard')}>
            <Text style={styles.menuLabel}>Company Dashboard</Text>
          </TouchableOpacity>
        )}
        {isEmployee && (
          <TouchableOpacity style={styles.menuItem} onPress={() => navigation.navigate('EmployeeDashboard')}>
            <Text style={styles.menuLabel}>My Dashboard</Text>
          </TouchableOpacity>
        )}
        {isAdmin && (
          <>
            <Text style={styles.sectionLabel}>Scheduler</Text>
            {schedulerItems.map((item) => (
              <TouchableOpacity key={item.name} style={styles.menuItem} onPress={() => navigation.navigate(item.name)}>
                <Text style={styles.menuLabel}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </>
        )}
        <Text style={styles.sectionLabel}>Management</Text>
        <TouchableOpacity style={styles.menuItem} onPress={() => navigation.navigate('Account')}>
          <Text style={styles.menuLabel}>Account</Text>
        </TouchableOpacity>
        {isAdmin &&
          managementExtra.map((item) => (
            <TouchableOpacity key={item.name} style={styles.menuItem} onPress={() => navigation.navigate(item.name)}>
              <Text style={styles.menuLabel}>{item.label}</Text>
            </TouchableOpacity>
          ))}
      </ScrollView>

      <View style={styles.drawerFooter}>
        <TouchableOpacity
          style={styles.footerRow}
          onPress={() => {
            navigation.navigate('ClockIn');
            navigation.closeDrawer();
          }}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons name="clock-outline" size={22} color="#475569" />
          <Text style={styles.footerRowLabel}>Clock In</Text>
        </TouchableOpacity>

        <View style={styles.footerUserRow}>
          <View style={styles.footerAvatar}>
            <MaterialCommunityIcons name="account" size={20} color="#94a3b8" />
          </View>
          <Text style={styles.footerEmail} numberOfLines={1}>
            {user?.email || '—'}
          </Text>
        </View>

        <TouchableOpacity
          style={styles.footerRow}
          onPress={() => signOut()}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons name="logout" size={22} color="#475569" />
          <Text style={styles.footerRowLabel}>Sign out</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function MainDrawer() {
  const { role } = useAuth();
  return (
    <Drawer.Navigator
      initialRouteName={getMainDrawerInitialRoute(role)}
      screenOptions={{
        headerStyle: { backgroundColor: '#fff' },
        headerTintColor: '#0f172a',
        headerTitleStyle: { fontWeight: '600' },
        drawerType: 'front',
      }}
      drawerContent={(props) => <CustomDrawerContent {...props} />}
    >
      <Drawer.Screen name="Home" component={HomeScreen} options={{ title: 'Home' }} />
      <Drawer.Screen name="SuperAdminDashboard" component={SuperAdminDashboard} options={{ title: 'Super Admin Dashboard' }} />
      <Drawer.Screen name="OrganizationDashboard" component={OrganizationDashboard} options={{ title: 'Organization' }} />
      <Drawer.Screen name="CompanyDashboard" component={CompanyDashboard} options={{ title: 'Company' }} />
      <Drawer.Screen name="EmployeeDashboard" component={EmployeeDashboard} options={{ title: 'My Dashboard' }} />
      <Drawer.Screen name="Calendar" component={CalendarScreen} options={{ title: 'Calendar' }} />
      <Drawer.Screen name="Tasks" component={TasksScreen} options={{ title: 'Tasks' }} />
      <Drawer.Screen name="Focus" component={FocusScreen} options={{ title: 'Focus Hours' }} />
      <Drawer.Screen name="Habits" component={HabitsScreen} options={{ title: 'Daily Routines' }} />
      <Drawer.Screen name="UserManagement" component={UserManagementScreen} options={{ title: 'User Management' }} />
      <Drawer.Screen name="CheckLists" component={TemplateScreen} options={{ title: 'Check Lists' }} />
      <Drawer.Screen name="Account" component={AccountScreen} options={{ title: 'Account' }} />
      <Drawer.Screen name="ClockIn" component={ClockInScreen} options={{ title: 'Clock In' }} />
      <Drawer.Screen name="Companies" component={CompaniesScreen} options={{ title: 'Companies' }} />
      <Drawer.Screen name="Schedule" component={ScheduleScreen} options={{ title: 'Schedule' }} />
      <Drawer.Screen name="Employees" component={EmployeesScreen} options={{ title: 'Employees' }} />
      <Drawer.Screen name="TimeClock" component={TimeClockScreen} options={{ title: 'Time Clock' }} />
      <Drawer.Screen name="EmployeeSchedule" component={EmployeeScheduleScreen} options={{ title: 'Employee Schedule' }} />
      <Drawer.Screen name="MissedShifts" component={MissedShiftsScreen} options={{ title: 'Missed Shifts' }} />
    </Drawer.Navigator>
  );
}

const styles = StyleSheet.create({
  drawer: { flex: 1, paddingTop: 48, backgroundColor: '#f8fafc' },
  drawerScroll: { flex: 1 },
  drawerScrollContent: { paddingHorizontal: 12, paddingBottom: 16 },
  header: { paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#e2e8f0', marginBottom: 8 },
  brandRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  brandZen: { fontSize: 18, fontWeight: '700', color: '#0f172a' },
  brandIcon: { marginHorizontal: 2 },
  brandScheduler: { fontSize: 18, fontWeight: '700', color: '#0f172a' },
  roleBadge: { fontSize: 11, color: '#64748b', marginTop: 6 },
  sectionLabel: { fontSize: 11, fontWeight: '600', color: '#64748b', marginTop: 16, marginBottom: 4 },
  menuItem: { paddingVertical: 12, paddingHorizontal: 8 },
  menuLabel: { fontSize: 15, color: '#0f172a' },
  drawerFooter: {
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 28,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  footerRowLabel: { fontSize: 15, color: '#334155', fontWeight: '500' },
  footerUserRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 8,
    marginVertical: 4,
  },
  footerAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerEmail: { flex: 1, fontSize: 13, color: '#64748b' },
});
