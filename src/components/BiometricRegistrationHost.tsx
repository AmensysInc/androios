import { useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { promptFirstTimeDeviceRegistration } from '../lib/deviceBiometricRegistration';

/**
 * After login (or restored session), prompts once per user per device to register Face ID / fingerprint for clock-in.
 */
export default function BiometricRegistrationHost() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user?.id) return;
    void promptFirstTimeDeviceRegistration(user.id);
  }, [user?.id]);

  return null;
}
