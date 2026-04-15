import React from 'react';
import { createDrawerNavigator } from '@react-navigation/drawer';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAuth, type User } from '../context/AuthContext';
import { getPrimaryRoleFromUser, getRoleDisplayLabel, mergeNestedAuthUserPayload } from '../types/auth';
import { getMainDrawerInitialRoute } from './mainDrawerInitialRoute';

import SuperAdminDashboard from '../screens/SuperAdminDashboard';
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
import HotelCleaningScreen from '../screens/hotel/HotelCleaningScreen';
import EmployeeHotelScreen from '../screens/hotel/EmployeeHotelScreen';
import { useHotelCleaningAccess } from '../hooks/useHotelCleaningAccess';

const Drawer = createDrawerNavigator();

/** Same order/labels as web `AppSidebar` `schedulerAdminItems`. */
const SCHEDULER_DRAWER_ITEMS = [
  { name: 'Companies', label: 'Companies' },
  { name: 'Schedule', label: 'Schedule' },
  { name: 'Employees', label: 'Employees' },
  { name: 'EmployeeSchedule', label: 'Employee Schedule' },
  { name: 'TimeClock', label: 'Time Clock' },
  { name: 'MissedShifts', label: 'Missed Shifts' },
] as const;

type SchedulerDrawerItem = (typeof SCHEDULER_DRAWER_ITEMS)[number];

/**
 * Matches web `schedulerItemsForRole`: company manager has no Companies; org manager has no Schedule;
 * super_admin and admin see everything.
 */
function getSchedulerItemsForRole(role: string | null | undefined): SchedulerDrawerItem[] {
  const all = [...SCHEDULER_DRAWER_ITEMS];
  if (role === 'super_admin') return all;
  if (role === 'company_manager') return all.filter((i) => i.name !== 'Companies');
  if (role === 'organization_manager') return all.filter((i) => i.name !== 'Schedule');
  return all;
}

function CustomDrawerContent({ navigation }: any) {
  const { user, role, signOut, isLoading } = useAuth();
  const mergedDrawerUser = user ? (mergeNestedAuthUserPayload(user) as User) : null;
  /** Merged + raw: some envelopes keep `roles[]` only on the outer `/auth/user/` object. */
  const primaryFromMerged = mergedDrawerUser ? getPrimaryRoleFromUser(mergedDrawerUser as any) : null;
  const primaryFromRaw = user ? getPrimaryRoleFromUser(user as any) : null;
  const primaryFromSessionUser = primaryFromMerged ?? primaryFromRaw;
  const {
    allowed: hotelAllowed,
    resolved: hotelAccessResolved,
    variant: hotelVariant,
  } = useHotelCleaningAccess(user, role ?? primaryFromSessionUser);

  const mainItems = [
    { name: 'Calendar', label: 'Calendar' },
    { name: 'Tasks', label: 'Tasks' },
    { name: 'Focus', label: 'Focus Hours' },
    { name: 'Habits', label: 'Daily Routines' },
  ];

  const schedulerItemsForRole = getSchedulerItemsForRole(role);

  /** Matches web `AppSidebar`: Check Lists for these roles only (not plain `admin`). */
  const canSeeCheckLists =
    role === 'super_admin' || role === 'company_manager' || role === 'organization_manager';

  const isAdmin = role && ['super_admin', 'organization_manager', 'company_manager'].includes(role);
  /** Canonical employee: auth context, merged user, or raw payload (covers merge / timing edge cases). */
  const isEmployeeUser =
    role === 'employee' ||
    primaryFromMerged === 'employee' ||
    primaryFromRaw === 'employee';

  const canSeeEmployeeRooms =
    Boolean(user) &&
    !isLoading &&
    hotelAccessResolved &&
    hotelAllowed &&
    hotelVariant === 'employee_cleaning';

  const canSeeUserManagement =
    primaryFromSessionUser === 'super_admin' ||
    primaryFromSessionUser === 'organization_manager' ||
    primaryFromSessionUser === 'company_manager';

  const adminDashboard = role === 'super_admin';

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
        {mainItems.map((item) => (
          <TouchableOpacity key={item.name} style={styles.menuItem} onPress={() => navigation.navigate(item.name)}>
            <Text style={styles.menuLabel}>{item.label}</Text>
          </TouchableOpacity>
        ))}
        {adminDashboard && (
          <TouchableOpacity style={styles.menuItem} onPress={() => navigation.navigate('SuperAdminDashboard')}>
            <Text style={styles.menuLabel}>Super Admin Dashboard</Text>
          </TouchableOpacity>
        )}
        {isEmployeeUser && (
          <TouchableOpacity style={styles.menuItem} onPress={() => navigation.navigate('EmployeeDashboard')}>
            <Text style={styles.menuLabel}>My Dashboard</Text>
          </TouchableOpacity>
        )}
        {canSeeEmployeeRooms && (
          <>
            <Text style={styles.sectionLabel}>Motel</Text>
            <TouchableOpacity style={styles.menuItem} onPress={() => navigation.navigate('EmployeeHotel')}>
              <Text style={styles.menuLabel}>Rooms</Text>
            </TouchableOpacity>
          </>
        )}
        {!isLoading && user && hotelAccessResolved && hotelAllowed && hotelVariant === 'admin_rooms' && (
          <>
            <Text style={styles.sectionLabel}>Motel</Text>
            <TouchableOpacity style={styles.menuItem} onPress={() => navigation.navigate('Hotel')}>
              <Text style={styles.menuLabel}>Hotel</Text>
            </TouchableOpacity>
          </>
        )}
        {isAdmin && (
          <>
            <Text style={styles.sectionLabel}>Scheduler</Text>
            {schedulerItemsForRole.map((item) => (
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
        {canSeeCheckLists && (
          <TouchableOpacity style={styles.menuItem} onPress={() => navigation.navigate('CheckLists')}>
            <Text style={styles.menuLabel}>Check Lists</Text>
          </TouchableOpacity>
        )}
        {canSeeUserManagement && (
          <TouchableOpacity style={styles.menuItem} onPress={() => navigation.navigate('UserManagement')}>
            <Text style={styles.menuLabel}>User Management</Text>
          </TouchableOpacity>
        )}
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
      <Drawer.Screen name="SuperAdminDashboard" component={SuperAdminDashboard} options={{ title: 'Super Admin Dashboard' }} />
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
      <Drawer.Screen name="Hotel" component={HotelCleaningScreen} options={{ title: 'Hotel' }} />
      <Drawer.Screen name="EmployeeHotel" component={EmployeeHotelScreen} options={{ title: 'Rooms' }} />
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
