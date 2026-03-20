import React from 'react';
import { createDrawerNavigator } from '@react-navigation/drawer';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { getRoleDisplayLabel } from '../types/auth';

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
import ProfileScreen from '../screens/ProfileScreen';
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

  const adminItems = [
    { name: 'SuperAdminDashboard', label: 'Super Admin Dashboard' },
    { name: 'OrganizationDashboard', label: 'Organization Dashboard' },
    { name: 'CompanyDashboard', label: 'Company Dashboard' },
    { name: 'EmployeeDashboard', label: 'Employee Dashboard' },
  ];

  const schedulerItems = [
    { name: 'Companies', label: 'Companies' },
    { name: 'Schedule', label: 'Schedule' },
    { name: 'Employees', label: 'Employees' },
    { name: 'TimeClock', label: 'Time Clock' },
    { name: 'EmployeeSchedule', label: 'Employee Schedule' },
    { name: 'MissedShifts', label: 'Missed Shifts' },
  ];

  const otherItems = [
    { name: 'UserManagement', label: 'User Management' },
    { name: 'Template', label: 'Templates' },
    { name: 'ClockIn', label: 'Clock In' },
    { name: 'Account', label: 'Account' },
    { name: 'Profile', label: 'Profile' },
  ];

  const isAdmin = role && ['super_admin', 'admin', 'operations_manager', 'manager'].includes(role);
  const isEmployee = role && ['employee', 'house_keeping', 'maintenance'].includes(role);

  return (
    <View style={styles.drawer}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Zeno Time Flow</Text>
        {user?.email && <Text style={styles.headerSub} numberOfLines={1}>{user.email}</Text>}
        {role && <Text style={styles.roleBadge}>{getRoleDisplayLabel(role)}</Text>}
      </View>
      <TouchableOpacity style={styles.menuItem} onPress={() => navigation.navigate('Home')}>
        <Text style={styles.menuLabel}>Home</Text>
      </TouchableOpacity>
      {mainItems.slice(1).map((item) => (
        <TouchableOpacity key={item.name} style={styles.menuItem} onPress={() => navigation.navigate(item.name)}>
          <Text style={styles.menuLabel}>{item.label}</Text>
        </TouchableOpacity>
      ))}
      {(role === 'super_admin' || role === 'admin') && (
        <TouchableOpacity style={styles.menuItem} onPress={() => navigation.navigate('SuperAdminDashboard')}>
          <Text style={styles.menuLabel}>Super Admin Dashboard</Text>
        </TouchableOpacity>
      )}
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
      <Text style={styles.sectionLabel}>More</Text>
      {otherItems.map((item) => (
        <TouchableOpacity key={item.name} style={styles.menuItem} onPress={() => navigation.navigate(item.name)}>
          <Text style={styles.menuLabel}>{item.label}</Text>
        </TouchableOpacity>
      ))}
      <TouchableOpacity style={styles.signOut} onPress={() => signOut()}>
        <Text style={styles.signOutText}>Sign out</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function MainDrawer() {
  return (
    <Drawer.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: '#fff' },
        headerTintColor: '#0f172a',
        headerTitleStyle: { fontWeight: '600' },
        drawerType: 'front',
      }}
      drawerContent={(props) => <CustomDrawerContent {...props} />}
    >
      <Drawer.Screen name="Home" component={HomeScreen} options={{ title: 'Home' }} />
      <Drawer.Screen name="SuperAdminDashboard" component={SuperAdminDashboard} options={{ title: 'Super Admin' }} />
      <Drawer.Screen name="OrganizationDashboard" component={OrganizationDashboard} options={{ title: 'Organization' }} />
      <Drawer.Screen name="CompanyDashboard" component={CompanyDashboard} options={{ title: 'Company' }} />
      <Drawer.Screen name="EmployeeDashboard" component={EmployeeDashboard} options={{ title: 'My Dashboard' }} />
      <Drawer.Screen name="Calendar" component={CalendarScreen} options={{ title: 'Calendar' }} />
      <Drawer.Screen name="Tasks" component={TasksScreen} options={{ title: 'Tasks' }} />
      <Drawer.Screen name="Focus" component={FocusScreen} options={{ title: 'Focus Hours' }} />
      <Drawer.Screen name="Habits" component={HabitsScreen} options={{ title: 'Daily Routines' }} />
      <Drawer.Screen name="UserManagement" component={UserManagementScreen} options={{ title: 'User Management' }} />
      <Drawer.Screen name="Template" component={TemplateScreen} options={{ title: 'Templates' }} />
      <Drawer.Screen name="Profile" component={ProfileScreen} options={{ title: 'Profile' }} />
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
  drawer: { flex: 1, paddingTop: 48, paddingHorizontal: 12 },
  header: { paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#e2e8f0', marginBottom: 8 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#0f172a' },
  headerSub: { fontSize: 12, color: '#64748b', marginTop: 4 },
  roleBadge: { fontSize: 11, color: '#64748b', marginTop: 2 },
  sectionLabel: { fontSize: 11, fontWeight: '600', color: '#64748b', marginTop: 16, marginBottom: 4 },
  menuItem: { paddingVertical: 12, paddingHorizontal: 8 },
  menuLabel: { fontSize: 15, color: '#0f172a' },
  signOut: { marginTop: 24, padding: 16, borderTopWidth: 1, borderTopColor: '#e2e8f0' },
  signOutText: { color: '#ef4444', fontSize: 15, fontWeight: '600' },
});
