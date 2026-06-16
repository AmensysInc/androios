import React, { useMemo, useState } from 'react';
import {
  createDrawerNavigator,
  DrawerContentScrollView,
  DrawerToggleButton,
  type DrawerContentComponentProps,
} from '@react-navigation/drawer';
import { getFocusedRouteNameFromRoute } from '@react-navigation/native';
import { View, Text, TouchableOpacity, StyleSheet, TextInput, Alert } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAuth, type User } from '../context/AuthContext';
import { getPrimaryRoleFromUser, mergeNestedAuthUserPayload } from '../types/auth';
import { getMainDrawerInitialRoute } from './mainDrawerInitialRoute';

import SuperAdminDashboard from '../screens/SuperAdminDashboard';
import EmployeeDashboard from '../screens/EmployeeDashboard';
import CalendarScreen from '../screens/CalendarScreen';
import TasksScreen from '../screens/TasksScreen';
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
import EmployeeRoomsStack from './EmployeeRoomsStack';
import { useHotelCleaningAccess } from '../hooks/useHotelCleaningAccess';
import LanguageSwitcher from '../components/LanguageSwitcher';

const Drawer = createDrawerNavigator();

const COLORS = {
  bg: '#151728',
  bgElevated: '#1c1f33',
  border: '#2a2d42',
  searchBg: '#1e2136',
  text: '#f1f5f9',
  textMuted: '#94a3b8',
  section: '#64748b',
  logoPurple: '#7c3aed',
  avatarBlue: '#3b82f6',
  activeBg: '#252a45',
  activeText: '#ffffff',
};

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

type MenuItem = {
  name: string;
  labelKey: string;
  icon: IconName;
  trailingIcon?: IconName;
};

type MenuSection = {
  key: string;
  title: string;
  items: MenuItem[];
};

/** Same order/labels as web `AppSidebar` `schedulerAdminItems`. */
const SCHEDULER_ITEMS: MenuItem[] = [
  { name: 'Companies', labelKey: 'sidebar.companies', icon: 'office-building-outline' },
  { name: 'Employees', labelKey: 'sidebar.departments', icon: 'layers-outline' },
  { name: 'UserManagement', labelKey: 'sidebar.employeeRoles', icon: 'account-outline' },
  { name: 'Schedule', labelKey: 'sidebar.schedule', icon: 'calendar-month-outline' },
  { name: 'Employees', labelKey: 'sidebar.employees', icon: 'account-group-outline' },
  { name: 'EmployeeSchedule', labelKey: 'sidebar.employeeSchedule', icon: 'calendar-account-outline' },
  { name: 'TimeClock', labelKey: 'sidebar.timeClock', icon: 'clock-outline' },
  { name: 'MissedShifts', labelKey: 'sidebar.missedShifts', icon: 'calendar-remove-outline' },
];

function getSchedulerItemsForRole(role: string | null | undefined): MenuItem[] {
  const hideCompanies = role === 'company_manager';
  const hideSchedule = role === 'organization_manager';
  return SCHEDULER_ITEMS.filter((item) => {
    if (hideCompanies && item.name === 'Companies') return false;
    if (hideSchedule && item.name === 'Schedule') return false;
    return true;
  });
}

function getActiveRouteName(state: DrawerContentComponentProps['state']): string {
  const drawerRoute = state.routes[state.index];
  return getFocusedRouteNameFromRoute(drawerRoute) ?? drawerRoute.name;
}

function getUserInitials(user: User | null): string {
  if (!user) return '?';
  const name = user.full_name?.trim();
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }
  const handle = (user.username || user.email || '').split('@')[0];
  if (handle.length >= 2) return handle.slice(0, 2).toUpperCase();
  return handle.slice(0, 1).toUpperCase() || '?';
}

function getUserHandle(user: User | null): string {
  if (!user) return '—';
  if (user.username?.trim()) return user.username.trim();
  const email = user.email?.trim();
  if (email) return email.split('@')[0];
  return user.full_name?.trim() || '—';
}

function isMenuItemActive(item: MenuItem, activeRoute: string): boolean {
  if (activeRoute === item.name) return true;
  if (
    item.name === 'EmployeeHotel' &&
    (activeRoute === 'EmployeeRoomsList' || activeRoute === 'RoomCleaningDetails')
  ) {
    return true;
  }
  return false;
}

function sidebarRoleLabel(role: string | null | undefined, t: (key: string) => string): string {
  if (role === 'super_admin') return t('roles.administrator');
  if (role === 'organization_manager') return t('roles.organizationManager');
  if (role === 'company_manager') return t('roles.companyManager');
  if (role === 'employee') return t('roles.employee');
  return t('roles.employee');
}

function MenuRow({
  item,
  active,
  onPress,
}: {
  item: MenuItem;
  active: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  return (
    <TouchableOpacity
      style={[styles.menuRow, active && styles.menuRowActive]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <MaterialCommunityIcons
        name={item.icon}
        size={20}
        color={active ? COLORS.activeText : COLORS.textMuted}
        style={styles.menuIcon}
      />
      <Text style={[styles.menuLabel, active && styles.menuLabelActive]} numberOfLines={1}>
        {t(item.labelKey)}
      </Text>
      {item.trailingIcon ? (
        <MaterialCommunityIcons name={item.trailingIcon} size={16} color={COLORS.textMuted} />
      ) : null}
    </TouchableOpacity>
  );
}

function CustomDrawerContent({ navigation, state }: DrawerContentComponentProps) {
  const { t, i18n } = useTranslation();
  const { user, role, signOut, isLoading } = useAuth();
  const [search, setSearch] = useState('');
  const mergedDrawerUser = user ? (mergeNestedAuthUserPayload(user) as User) : null;
  const primaryFromMerged = mergedDrawerUser ? getPrimaryRoleFromUser(mergedDrawerUser as any) : null;
  const primaryFromRaw = user ? getPrimaryRoleFromUser(user as any) : null;
  const primaryFromSessionUser = primaryFromMerged ?? primaryFromRaw;
  const {
    allowed: hotelAllowed,
    resolved: hotelAccessResolved,
    variant: hotelVariant,
  } = useHotelCleaningAccess(user, role ?? primaryFromSessionUser);

  const activeRoute = getActiveRouteName(state);
  const query = search.trim().toLowerCase();

  const confirmSignOut = () => {
    Alert.alert(t('settings.logoutConfirm.title'), t('settings.logoutConfirm.message'), [
      { text: t('settings.logoutConfirm.cancel'), style: 'cancel' },
      {
        text: t('settings.logoutConfirm.confirm'),
        style: 'destructive',
        onPress: () => void signOut(),
      },
    ]);
  };

  const isAdmin = role && ['super_admin', 'organization_manager', 'company_manager'].includes(role);
  const isEmployeeUser =
    role === 'employee' || primaryFromMerged === 'employee' || primaryFromRaw === 'employee';
  const adminDashboard = role === 'super_admin';
  const canSeeCheckLists =
    role === 'super_admin' || role === 'company_manager' || role === 'organization_manager';
  const canSeeUserManagement =
    primaryFromSessionUser === 'super_admin' ||
    primaryFromSessionUser === 'organization_manager' ||
    primaryFromSessionUser === 'company_manager';
  const canSeeEmployeeRooms =
    Boolean(user) &&
    !isLoading &&
    hotelAccessResolved &&
    hotelAllowed &&
    hotelVariant === 'employee_cleaning';
  const canSeeHotelAdmin =
    !isLoading && Boolean(user) && hotelAccessResolved && hotelAllowed && hotelVariant === 'admin_rooms';

  const sections = useMemo(() => {
    const result: MenuSection[] = [];

    const workforce: MenuItem[] = [];
    if (adminDashboard) {
      workforce.push({
        name: 'SuperAdminDashboard',
        labelKey: 'sidebar.dashboard',
        icon: 'view-dashboard-outline',
        trailingIcon: 'home-outline',
      });
    } else if (isEmployeeUser) {
      workforce.push({
        name: 'EmployeeDashboard',
        labelKey: 'sidebar.myDashboard',
        icon: 'view-dashboard-outline',
        trailingIcon: 'home-outline',
      });
    }
    workforce.push(
      { name: 'Calendar', labelKey: 'sidebar.calendar', icon: 'calendar-outline' },
      { name: 'Tasks', labelKey: 'sidebar.tasks', icon: 'checkbox-marked-circle-outline' },
    );
    result.push({ key: 'workforce', title: t('sidebar.workforce'), items: workforce });

    if (isAdmin) {
      result.push({
        key: 'scheduling',
        title: t('sidebar.scheduling'),
        items: getSchedulerItemsForRole(role),
      });
    }

    const motel: MenuItem[] = [];
    if (canSeeEmployeeRooms) {
      motel.push({ name: 'EmployeeHotel', labelKey: 'sidebar.rooms', icon: 'door-open' });
    }
    if (canSeeHotelAdmin) {
      motel.push({ name: 'Hotel', labelKey: 'sidebar.houseKeeping', icon: 'bed-outline' });
    }
    if (motel.length) {
      result.push({ key: 'motel', title: t('sidebar.motel'), items: motel });
    }

    const management: MenuItem[] = [{ name: 'Account', labelKey: 'settings.account', icon: 'account-cog-outline' }];
    if (canSeeCheckLists) {
      management.push({ name: 'CheckLists', labelKey: 'sidebar.checkLists', icon: 'format-list-checks' });
    }
    if (canSeeUserManagement && !isAdmin) {
      management.push({ name: 'UserManagement', labelKey: 'sidebar.userManagement', icon: 'account-group-outline' });
    }
    result.push({ key: 'management', title: t('sidebar.management'), items: management });

    return result;
  }, [
    adminDashboard,
    isEmployeeUser,
    isAdmin,
    role,
    canSeeEmployeeRooms,
    canSeeHotelAdmin,
    canSeeCheckLists,
    canSeeUserManagement,
    t,
    i18n.language,
  ]);

  const filteredSections = useMemo(() => {
    if (!query) return sections;
    return sections
      .map((section) => ({
        ...section,
        items: section.items.filter((item) => t(item.labelKey).toLowerCase().includes(query)),
      }))
      .filter((section) => section.items.length > 0);
  }, [sections, query, t]);

  const navigateTo = (name: string) => {
    navigation.navigate(name);
    navigation.closeDrawer();
  };

  return (
    <View style={styles.drawer}>
      <View style={styles.header}>
        <View style={styles.brandRow}>
          <View style={styles.logoBox}>
            <MaterialCommunityIcons name="clock-outline" size={20} color="#fff" />
          </View>
          <View style={styles.brandTextWrap}>
            <Text style={styles.brandTitle}>ZenoTimeFlow</Text>
            <Text style={styles.brandTagline}>{t('sidebar.brandTagline')}</Text>
          </View>
          <TouchableOpacity
            onPress={() => navigation.closeDrawer()}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.collapseBtn}
          >
            <MaterialCommunityIcons name="dock-left" size={20} color={COLORS.textMuted} />
          </TouchableOpacity>
        </View>

        <View style={styles.searchWrap}>
          <MaterialCommunityIcons name="magnify" size={18} color={COLORS.textMuted} style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder={t('sidebar.searchNavigation')}
            placeholderTextColor={COLORS.section}
            value={search}
            onChangeText={setSearch}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
          />
        </View>
      </View>

      <DrawerContentScrollView
        contentContainerStyle={styles.drawerScrollContent}
        showsVerticalScrollIndicator={false}
        style={styles.drawerScroll}
      >
        {filteredSections.map((section) => (
          <View key={section.key} style={styles.section}>
            <Text style={styles.sectionLabel}>{section.title}</Text>
            {section.items.map((item, index) => (
              <MenuRow
                key={`${section.key}-${item.name}-${item.labelKey}-${index}`}
                item={item}
                active={isMenuItemActive(item, activeRoute)}
                onPress={() => navigateTo(item.name)}
              />
            ))}
          </View>
        ))}
      </DrawerContentScrollView>

      <View style={styles.drawerFooter}>
        <TouchableOpacity
          style={styles.footerMenuRow}
          onPress={() => navigateTo('ClockIn')}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons name="clock-check-outline" size={20} color={COLORS.textMuted} />
          <Text style={styles.footerMenuLabel}>{t('sidebar.clockIn')}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.profileCard} onPress={() => navigateTo('Account')} activeOpacity={0.8}>
          <View style={styles.profileAvatar}>
            <Text style={styles.profileInitials}>{getUserInitials(user)}</Text>
          </View>
          <View style={styles.profileInfo}>
            <Text style={styles.profileName} numberOfLines={1}>
              {getUserHandle(user)}
            </Text>
            <Text style={styles.profileRole} numberOfLines={1}>
              {sidebarRoleLabel(role, t)}
            </Text>
          </View>
          <MaterialCommunityIcons name="chevron-down" size={20} color={COLORS.textMuted} />
        </TouchableOpacity>

        <TouchableOpacity style={styles.footerMenuRow} onPress={confirmSignOut} activeOpacity={0.7}>
          <MaterialCommunityIcons name="logout" size={20} color={COLORS.textMuted} />
          <Text style={styles.footerMenuLabel}>{t('settings.logout')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function MainDrawer() {
  const { role } = useAuth();
  const { t } = useTranslation();
  return (
    <Drawer.Navigator
      initialRouteName={getMainDrawerInitialRoute(role)}
      screenOptions={{
        headerStyle: { backgroundColor: '#fff' },
        headerTintColor: '#0f172a',
        headerTitleStyle: { fontWeight: '600' },
        headerRight: () => <LanguageSwitcher />,
        drawerType: 'front',
        drawerStyle: { backgroundColor: COLORS.bg, width: 280 },
        overlayColor: 'rgba(0,0,0,0.45)',
      }}
      drawerContent={(props) => <CustomDrawerContent {...props} />}
    >
      <Drawer.Screen name="SuperAdminDashboard" component={SuperAdminDashboard} options={{ title: t('sidebar.superAdminDashboard') }} />
      <Drawer.Screen name="EmployeeDashboard" component={EmployeeDashboard} options={{ title: t('sidebar.myDashboard') }} />
      <Drawer.Screen name="Calendar" component={CalendarScreen} options={{ title: t('screens.calendar') }} />
      <Drawer.Screen name="Tasks" component={TasksScreen} options={{ title: t('screens.tasks') }} />
      <Drawer.Screen name="UserManagement" component={UserManagementScreen} options={{ title: t('sidebar.userManagement') }} />
      <Drawer.Screen name="CheckLists" component={TemplateScreen} options={{ title: t('screens.checkLists') }} />
      <Drawer.Screen name="Account" component={AccountScreen} options={{ title: t('settings.title') }} />
      <Drawer.Screen name="ClockIn" component={ClockInScreen} options={{ title: t('screens.clockIn') }} />
      <Drawer.Screen name="Companies" component={CompaniesScreen} options={{ title: t('screens.companies') }} />
      <Drawer.Screen name="Schedule" component={ScheduleScreen} options={{ title: t('screens.schedule') }} />
      <Drawer.Screen name="Employees" component={EmployeesScreen} options={{ title: t('screens.employees') }} />
      <Drawer.Screen name="TimeClock" component={TimeClockScreen} options={{ title: t('screens.timeClock') }} />
      <Drawer.Screen name="EmployeeSchedule" component={EmployeeScheduleScreen} options={{ title: t('screens.employeeSchedule') }} />
      <Drawer.Screen name="MissedShifts" component={MissedShiftsScreen} options={{ title: t('screens.missedShifts') }} />
      <Drawer.Screen name="Hotel" component={HotelCleaningScreen} options={{ title: t('screens.houseKeeping') }} />
      <Drawer.Screen
        name="EmployeeHotel"
        component={EmployeeRoomsStack}
        options={({ route }) => {
          const routeName = getFocusedRouteNameFromRoute(route) ?? 'EmployeeRoomsList';
          return {
            title: t('screens.rooms'),
            headerShown: routeName === 'EmployeeRoomsList',
            headerLeft: () => <DrawerToggleButton tintColor="#0f172a" />,
          };
        }}
      />
    </Drawer.Navigator>
  );
}

const styles = StyleSheet.create({
  drawer: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  header: {
    paddingTop: 52,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  logoBox: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: COLORS.logoPurple,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  brandTextWrap: { flex: 1, paddingTop: 2 },
  brandTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.text,
    letterSpacing: 0.2,
  },
  brandTagline: {
    fontSize: 9,
    fontWeight: '600',
    color: COLORS.textMuted,
    marginTop: 3,
    letterSpacing: 0.8,
  },
  collapseBtn: {
    paddingTop: 4,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.searchBg,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 10,
    height: 38,
  },
  searchIcon: { marginRight: 6 },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: COLORS.text,
    paddingVertical: 0,
  },
  drawerScroll: { flex: 1 },
  drawerScrollContent: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 16,
  },
  section: { marginBottom: 8 },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.section,
    letterSpacing: 1.2,
    marginTop: 12,
    marginBottom: 4,
    paddingHorizontal: 8,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 8,
    marginBottom: 2,
  },
  menuRowActive: {
    backgroundColor: COLORS.activeBg,
  },
  menuIcon: { width: 24, marginRight: 10 },
  menuLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.textMuted,
  },
  menuLabelActive: {
    color: COLORS.activeText,
    fontWeight: '600',
  },
  drawerFooter: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 28,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.bg,
  },
  footerMenuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  footerMenuLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.textMuted,
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.bgElevated,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginVertical: 6,
    gap: 10,
  },
  profileAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.avatarBlue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileInitials: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
  },
  profileInfo: { flex: 1 },
  profileName: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  profileRole: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 2,
  },
});
