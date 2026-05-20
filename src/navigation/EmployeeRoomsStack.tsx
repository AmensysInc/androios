import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { MotelRoomRow } from '../api';
import { MotelCleaningSessionProvider } from '../context/MotelCleaningSessionContext';
import EmployeeRoomsScreen from '../screens/hotel/EmployeeRoomsScreen';
import RoomCleaningDetailsScreen from '../screens/hotel/RoomCleaningDetailsScreen';

export type EmployeeRoomsStackParamList = {
  EmployeeRoomsList: { submittedRoomId?: string } | undefined;
  RoomCleaningDetails: { room: MotelRoomRow };
};

const Stack = createNativeStackNavigator<EmployeeRoomsStackParamList>();

export default function EmployeeRoomsStack() {
  return (
    <MotelCleaningSessionProvider>
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
        options={{ title: 'Rooms', headerShown: false }}
      />
      <Stack.Screen
        name="RoomCleaningDetails"
        component={RoomCleaningDetailsScreen}
        options={({ route }) => ({
          title: `Room ${(route.params.room as any)?.room_number ?? route.params.room?.number ?? 'Details'}`,
        })}
      />
    </Stack.Navigator>
    </MotelCleaningSessionProvider>
  );
}
