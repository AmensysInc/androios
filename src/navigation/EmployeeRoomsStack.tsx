import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import type { MotelRoomRow } from '../api';
import { MotelCleaningSessionProvider } from '../context/MotelCleaningSessionContext';
import EmployeeRoomsScreen from '../screens/hotel/EmployeeRoomsScreen';
import RoomCleaningDetailsScreen from '../screens/hotel/RoomCleaningDetailsScreen';
import { motelRoomNumber } from '../lib/motelRoomDisplay';

export type EmployeeRoomsStackParamList = {
  EmployeeRoomsList: { submittedRoomId?: string } | undefined;
  RoomCleaningDetails: { room: MotelRoomRow };
};

const Stack = createNativeStackNavigator<EmployeeRoomsStackParamList>();

function EmployeeRoomsStackInner() {
  const { t } = useTranslation();

  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: '#fff' },
        headerTintColor: '#0f172a',
        headerTitleStyle: { fontWeight: '600' },
      }}
    >
      <Stack.Screen
        name="EmployeeRoomsList"
        component={EmployeeRoomsScreen}
        options={{ title: t('screens.rooms'), headerShown: false }}
      />
      <Stack.Screen
        name="RoomCleaningDetails"
        component={RoomCleaningDetailsScreen}
        options={({ route }) => ({
          title: t('housekeeping.roomTitle', { number: motelRoomNumber(route.params.room) }),
        })}
      />
    </Stack.Navigator>
  );
}

export default function EmployeeRoomsStack() {
  return (
    <MotelCleaningSessionProvider>
      <EmployeeRoomsStackInner />
    </MotelCleaningSessionProvider>
  );
}
