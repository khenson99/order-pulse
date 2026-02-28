import { useState, useEffect } from 'react';
import { LoginScreen } from './views/LoginScreen';
import { OnboardingFlow } from './views/OnboardingFlow';
import { MobileScanner } from './views/MobileScanner';
import { GoogleUserProfile } from './types';
import {
  ardaApi,
  ArdaSyncedTenantContext,
  authApi,
  buildArdaOpenUrl,
  getLastSuccessfulSyncTenant,
  SESSION_EXPIRED_EVENT,
} from './services/api';
import { Icons } from './components/Icons';
import { InstructionCard } from './components/InstructionCard';

export default function App() {
  // Auth State
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [userProfile, setUserProfile] = useState<GoogleUserProfile | null>(null);
  
  // Track if user has completed onboarding
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(false);
  const [initialReturnTo, setInitialReturnTo] = useState<string | null>(null);
  const [importedItemCount, setImportedItemCount] = useState(0);
  const [syncedTenant, setSyncedTenant] = useState<ArdaSyncedTenantContext | null>(null);

  const loadSyncedTenant = async () => {
    try {
      const status = await ardaApi.getSyncStatus();
      setSyncedTenant(getLastSuccessfulSyncTenant(status));
    } catch {
      // Keep completion UX resilient when sync-status can't be fetched.
      setSyncedTenant(null);
    }
  };

  useEffect(() => {
    const handleSessionExpired = () => {
      setUserProfile(null);
      setHasCompletedOnboarding(false);
      setImportedItemCount(0);
      localStorage.removeItem('orderPulse_onboardingComplete');
    };

    window.addEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
    return () => {
      window.removeEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
    };
  }, []);

  useEffect(() => {
    if (!userProfile) {
      setSyncedTenant(null);
      return;
    }
    void loadSyncedTenant();
  }, [userProfile?.id]);

  // Check auth on mount
  useEffect(() => {
    const checkAuth = async () => {
      try {
        // Check for auth token in URL (from OAuth callback)
        const urlParams = new URLSearchParams(window.location.search);
        const authToken = urlParams.get('token');
        const returnToParam = urlParams.get('returnTo');

        let data;
        if (authToken) {
          // Exchange token for session
          console.log('🔑 Exchanging auth token...');
          data = await authApi.exchangeToken(authToken);
          // Preserve returnTo before cleaning URL (used after Gmail-linking redirect)
          if (returnToParam) {
            setInitialReturnTo(returnToParam);
          }
          // Clean up URL
          window.history.replaceState({}, '', window.location.pathname);
          if (!data.user) return;
        } else {
          // Normal auth check
          data = await authApi.getCurrentUser();
          if (!data.user) return;
          if (returnToParam) {
            setInitialReturnTo(returnToParam);
            urlParams.delete('returnTo');
            const nextQuery = urlParams.toString();
            const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}${window.location.hash || ''}`;
            window.history.replaceState({}, document.title, nextUrl);
          }
        }

        setUserProfile({
          id: data.user.id,
          email: data.user.email,
          name: data.user.name,
          picture: data.user.picture_url,
        });
        // Check if user has completed onboarding before
        const completed = localStorage.getItem('orderPulse_onboardingComplete');
        if (completed === 'true') {
          setHasCompletedOnboarding(true);
        }
      } catch {
        // Not authenticated
      } finally {
        setIsCheckingAuth(false);
      }
    };
    checkAuth();
  }, []);

  const handleLogout = async () => {
    try {
      await authApi.logout();
    } catch {
      // Ignore logout errors
    }
    setUserProfile(null);
    setHasCompletedOnboarding(false);
    localStorage.removeItem('orderPulse_onboardingComplete');
  };

  const handleOnboardingComplete = (items: unknown[]) => {
    setImportedItemCount(items.length);
    setHasCompletedOnboarding(true);
    localStorage.setItem('orderPulse_onboardingComplete', 'true');
    void loadSyncedTenant();
  };

  const handleStartOver = () => {
    setHasCompletedOnboarding(false);
    setImportedItemCount(0);
    localStorage.removeItem('orderPulse_onboardingComplete');
  };

  const handleOpenArda = () => {
    const targetUrl = buildArdaOpenUrl(syncedTenant?.tenantId);
    window.open(targetUrl, '_blank', 'noopener,noreferrer');
  };

  // Check for mobile scanner routes (no auth required for scanning)
  const path = window.location.pathname;
  const scanMatch = path.match(/^\/scan\/([^/]+)$/);
  const photoMatch = path.match(/^\/photo\/([^/]+)$/);
  
  if (scanMatch) {
    return <MobileScanner sessionId={scanMatch[1]} mode="barcode" />;
  }
  
  if (photoMatch) {
    return <MobileScanner sessionId={photoMatch[1]} mode="photo" />;
  }

  // Show login screen if not authenticated
  if (isCheckingAuth) {
    return <LoginScreen onCheckingAuth={true} />;
  }
  
  if (!userProfile) {
    return (
      <LoginScreen
        onLoginSuccess={(user) => {
          setUserProfile({
            id: user.id,
            email: user.email,
            name: user.name,
            picture: user.picture_url,
          });
        }}
      />
    );
  }

  // Show completion screen if onboarding is done
  if (hasCompletedOnboarding) {
    return (
      <div className="relative min-h-screen arda-mesh flex flex-col">
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute -top-10 left-10 w-56 h-56 rounded-full bg-orange-400/15 blur-3xl animate-float" />
          <div className="absolute top-32 right-12 w-72 h-72 rounded-full bg-blue-500/10 blur-3xl animate-float" />
        </div>

        <header className="relative z-10 bg-white/80 backdrop-blur border-b border-arda-border px-6 py-4">
          <div className="max-w-5xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-orange-500 to-orange-600 rounded-lg flex items-center justify-center shadow-arda">
                <Icons.Package className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="font-bold text-arda-text-primary">Order Pulse</h1>
                <p className="text-xs text-arda-text-muted">Inventory Import Complete</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm text-arda-text-secondary">{userProfile.email}</span>
              <button
                onClick={handleLogout}
                className="text-sm text-arda-text-muted hover:text-arda-text-primary"
              >
                Logout
              </button>
            </div>
          </div>
        </header>

        <div className="relative z-10 flex-1 flex items-center justify-center p-8">
          <div className="w-full max-w-lg text-center arda-glass rounded-2xl p-8">
            <div className="w-20 h-20 mx-auto bg-green-100 rounded-full flex items-center justify-center mb-6">
              <Icons.CheckCircle2 className="w-10 h-10 text-green-500" />
            </div>
            <h2 className="text-2xl font-bold text-arda-text-primary mb-3">
              Setup Complete!
            </h2>
            <p className="text-arda-text-secondary mb-6">
              {importedItemCount > 0 
                ? `You've successfully imported ${importedItemCount} items to Arda.`
                : 'Your inventory setup is complete.'}
            </p>

            <InstructionCard
              title="What to do"
              icon="ExternalLink"
              steps={[
                'Open Arda to continue in your synced tenant.',
                'If Arda asks you to sign in, use this same account email.',
                'You can return anytime to import more items.',
              ]}
              className="mb-6 text-left"
            />

            <div className="mb-6 rounded-lg border border-arda-border bg-white p-4 text-left">
              <p className="text-xs uppercase tracking-wide text-arda-text-muted mb-1">Synced tenant</p>
              {syncedTenant ? (
                <>
                  <p className="font-mono text-sm text-arda-text-primary break-all">{syncedTenant.tenantId}</p>
                  {syncedTenant.email && (
                    <p className="text-xs text-arda-text-muted mt-1">Synced as {syncedTenant.email}</p>
                  )}
                </>
              ) : (
                <p className="text-xs text-arda-text-muted">Opening Arda home (no synced tenant detected).</p>
              )}
            </div>
            <div className="flex flex-col gap-3">
              <button
                onClick={handleOpenArda}
                className="btn-arda-primary w-full px-6 py-3 flex items-center justify-center gap-2"
              >
                <Icons.ExternalLink className="w-5 h-5" />
                Open Arda
              </button>
              <button
                onClick={handleStartOver}
                className="btn-arda-outline w-full px-6 py-3"
              >
                Import More Items
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Show onboarding flow
  return (
    <OnboardingFlow
      onComplete={handleOnboardingComplete}
      onSkip={() => setHasCompletedOnboarding(true)}
      userProfile={{ name: userProfile.name, email: userProfile.email }}
      initialReturnTo={initialReturnTo}
    />
  );
}
