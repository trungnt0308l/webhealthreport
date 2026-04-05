import { useEffect } from 'react';
import { useAuth0 } from '@auth0/auth0-react';

// Redirect /register to Auth0's signup screen.
// Auth0 Universal Login handles both login and registration.
export default function Register() {
  const { loginWithRedirect, isAuthenticated } = useAuth0();

  useEffect(() => {
    if (isAuthenticated) {
      window.location.replace('/account');
    } else {
      loginWithRedirect({
        authorizationParams: { screen_hint: 'signup' },
        appState: { returnTo: '/account' },
      });
    }
  }, [isAuthenticated, loginWithRedirect]);

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="text-slate-400 text-sm">Redirecting…</div>
    </div>
  );
}
