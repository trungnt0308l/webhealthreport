import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { Auth0Provider, useAuth0 } from '@auth0/auth0-react';
import Home from './pages/Home.jsx';
import ScanProgress from './pages/ScanProgress.jsx';
import Report from './pages/Report.jsx';
import Monitor from './pages/Monitor.jsx';
import Register from './pages/Register.jsx';
import Account from './pages/Account.jsx';
import FAQ from './pages/FAQ.jsx';

function ProtectedRoute({ children }) {
  const { isAuthenticated, isLoading, loginWithRedirect } = useAuth0();
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-500">Loading…</div>
      </div>
    );
  }
  if (!isAuthenticated) {
    loginWithRedirect({ appState: { returnTo: window.location.pathname } });
    return null;
  }
  return children;
}

function Auth0ProviderWithNavigate({ children }) {
  const navigate = useNavigate();

  const onRedirectCallback = (appState) => {
    navigate(appState?.returnTo || '/account');
  };

  return (
    <Auth0Provider
      domain={import.meta.env.VITE_AUTH0_DOMAIN}
      clientId={import.meta.env.VITE_AUTH0_CLIENT_ID}
      authorizationParams={{
        redirect_uri: window.location.origin + '/account',
        audience: import.meta.env.VITE_AUTH0_AUDIENCE,
      }}
      onRedirectCallback={onRedirectCallback}
    >
      {children}
    </Auth0Provider>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Auth0ProviderWithNavigate>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/scan/:id" element={<ScanProgress />} />
          <Route path="/report/:id" element={<Report />} />
          <Route path="/faq" element={<FAQ />} />
          <Route path="/monitor" element={<Monitor />} />
          <Route path="/register" element={<Register />} />
          <Route
            path="/account"
            element={
              <ProtectedRoute>
                <Account />
              </ProtectedRoute>
            }
          />
        </Routes>
      </Auth0ProviderWithNavigate>
    </BrowserRouter>
  );
}
