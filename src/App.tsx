import { useState, useEffect } from 'react';
import { LoginScreen } from './views/LoginScreen';
import { OnboardingFlow } from './views/OnboardingFlow';
import { MobileScanner } from './views/MobileScanner';
import { GoogleUserProfile } from './types';
import { authApi } from './services/api';
import { Icons } from './components/Icons';

export default function App() {
  // Auth State
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [userProfile, setUserProfile] = useState<GoogleUserProfile | null>(null);
  
  // Track if user has completed onboarding
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(false);
  const [importedItemCount, setImportedItemCount] = useState(0);

  // Check auth on mount
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const data = await authApi.getCurrentUser();
        if (data.user) {
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
  };

  const handleStartOver = () => {
    setHasCompletedOnboarding(false);
    setImportedItemCount(0);
    localStorage.removeItem('orderPulse_onboardingComplete');
  };

  const handleOpenArda = () => {
    window.open('https://app.arda.cards', '_blank');
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
    return <LoginScreen />;
  }

  // Show completion screen if onboarding is done
  if (hasCompletedOnboarding) {
    return (
      <div className="relative min-h-screen arda-mesh flex flex-col">
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute -top-10 left-10 w-56 h-56 rounded-full bg-orange-400/15 blur-3xl animate-float" />
          <div className="absolute top-32 right-12 w-72 h-72 rounded-full bg-blue-500/10 blur-3xl animate-float" />
        </div>
        {/* Header */}
        <header className="relative z-10 bg-white/70 backdrop-blur border-b border-arda-border/70 px-6 py-4">
          <div className="max-w-4xl mx-auto flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-orange-500 to-orange-600 rounded-2xl flex items-center justify-center shadow-arda">
                <Icons.Package className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="font-bold text-arda-text-primary leading-tight">Arda</h1>
                <p className="text-xs text-arda-text-muted">Inventory import complete</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <span className="hidden sm:inline text-sm text-arda-text-secondary">{userProfile.email}</span>
              <button
                onClick={handleLogout}
                className="text-sm text-arda-text-muted hover:text-arda-text-primary"
              >
                Logout
              </button>
            </div>
          </div>
        </header>

        {/* Success content */}
        <div className="relative z-10 flex-1 flex items-center justify-center p-8">
          <div className="w-full max-w-md text-center arda-glass rounded-2xl p-10">
            <div className="w-20 h-20 mx-auto bg-green-50 border border-green-200 rounded-2xl flex items-center justify-center mb-6">
              <Icons.CheckCircle2 className="w-10 h-10 text-green-600" />
            </div>
            <h2 className="text-2xl font-bold text-arda-text-primary mb-3">
              Setup Complete!
            </h2>
            <p className="text-arda-text-secondary mb-6">
              {importedItemCount > 0 
                ? `You've successfully imported ${importedItemCount} items to Arda.`
                : "Your inventory setup is complete."}
            </p>
            <div className="flex flex-col gap-3">
              <button
                onClick={handleOpenArda}
                className="w-full btn-arda-primary py-3 rounded-xl flex items-center justify-center gap-2"
              >
                <Icons.ExternalLink className="w-5 h-5" />
                Open Arda
              </button>
              <button
                onClick={handleStartOver}
                className="w-full btn-arda-outline py-3 rounded-xl"
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
    />
  );
}
