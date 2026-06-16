import React from 'react';
import { useTranslation } from 'react-i18next';
import PlaceholderScreen from '../components/PlaceholderScreen';

export default function OrganizationDashboard() {
  const { t } = useTranslation();
  return (
    <PlaceholderScreen
      title={t('roles.organizationManager')}
      subtitle={t('superAdminDashboard.subtitle')}
    />
  );
}
