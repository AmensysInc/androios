import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  useWindowDimensions,
  Platform,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';

type CardDef = {
  titleKey: string;
  subtitleKey: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  screen: string;
};

export default function SuperAdminDashboard() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  const { width } = useWindowDimensions();

  const dashboardCards = useMemo<CardDef[]>(
    () => [
      {
        titleKey: 'superAdminDashboard.organizationsCompanies',
        subtitleKey: 'superAdminDashboard.organizationsCompaniesDescription',
        icon: 'office-building-outline',
        screen: 'Companies',
      },
      {
        titleKey: 'superAdminDashboard.employees',
        subtitleKey: 'superAdminDashboard.employeesDescription',
        icon: 'account-multiple-outline',
        screen: 'Employees',
      },
      {
        titleKey: 'superAdminDashboard.schedules',
        subtitleKey: 'superAdminDashboard.schedulesDescription',
        icon: 'calendar-month-outline',
        screen: 'Schedule',
      },
      {
        titleKey: 'superAdminDashboard.userManagement',
        subtitleKey: 'superAdminDashboard.userManagementDescription',
        icon: 'account-group-outline',
        screen: 'UserManagement',
      },
    ],
    []
  );

  const cardWidth = useMemo(() => {
    const pad = 24 * 2;
    const gap = 12;
    if (width >= 1024) return (width - pad - gap * 3) / 4;
    if (width >= 640) return (width - pad - gap) / 2;
    return width - pad;
  }, [width]);

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.headerBlock}>
        <Text style={styles.pageTitle}>{t('superAdminDashboard.title')}</Text>
        <Text style={styles.pageSubtitle}>{t('superAdminDashboard.subtitle')}</Text>
      </View>

      <View style={styles.grid}>
        {dashboardCards.map((card) => (
          <TouchableOpacity
            key={card.screen}
            style={[
              styles.card,
              { width: cardWidth },
              Platform.OS === 'web' && styles.cardWeb,
            ]}
            onPress={() => navigation.navigate(card.screen)}
            activeOpacity={0.85}
          >
            <View style={styles.cardTop}>
              <Text style={styles.cardTitle}>{t(card.titleKey)}</Text>
              <MaterialCommunityIcons name={card.icon} size={28} color="#64748b" style={styles.cardIcon} />
            </View>
            <Text style={styles.cardSubtitle}>{t(card.subtitleKey)}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {user?.email ? (
        <Text style={styles.footerNote} numberOfLines={1}>
          {t('superAdminDashboard.signedInAs', { email: user.email })}
        </Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: '#f8fafc' },
  scrollContent: { padding: 24, paddingBottom: 40 },
  headerBlock: { marginBottom: 28 },
  pageTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: '#0f172a',
    letterSpacing: -0.5,
  },
  pageSubtitle: {
    fontSize: 15,
    color: '#64748b',
    marginTop: 8,
    lineHeight: 22,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 20,
    marginBottom: 0,
    minHeight: 132,
    justifyContent: 'space-between',
  },
  cardWeb: {
    boxShadow: '0 1px 3px rgba(15, 23, 42, 0.06)',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  cardTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: '#0f172a',
    lineHeight: 22,
    paddingRight: 8,
  },
  cardIcon: { marginTop: -2 },
  cardSubtitle: {
    fontSize: 13,
    color: '#64748b',
    lineHeight: 19,
    marginTop: 12,
  },
  footerNote: {
    marginTop: 32,
    fontSize: 12,
    color: '#94a3b8',
  },
});
