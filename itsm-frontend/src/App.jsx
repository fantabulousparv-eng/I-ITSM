import React, { useCallback, useEffect, useState } from 'react';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import { clearSession, readSession } from './services/api';

export default function App() {
  const [session, setSession] = useState(() => readSession());

  const logout = useCallback(() => {
    clearSession();
    setSession(null);
  }, []);

  // The API client fires this when a stored token is rejected.
  useEffect(() => {
    window.addEventListener('itsm:session-expired', logout);
    return () => window.removeEventListener('itsm:session-expired', logout);
  }, [logout]);

  if (!session) return <Login onLoginSuccess={() => setSession(readSession())} />;

  return <Dashboard user={session.user} token={session.token} onLogout={logout} />;
}
