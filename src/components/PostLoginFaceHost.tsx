import { useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { runPostLoginFacePromptIfNeeded } from '../lib/accountFaceAuth';

/**
 * After sign-in, optionally prompts for a live face verify when the employee has server-side enrollment.
 */
export default function PostLoginFaceHost() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user?.id) return;
    const t = setTimeout(() => {
      void runPostLoginFacePromptIfNeeded(user.id);
    }, 600);
    return () => clearTimeout(t);
  }, [user?.id]);

  return null;
}
