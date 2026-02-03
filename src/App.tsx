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
        // Check for auth token in URL (from OAuth callback)
        const urlParams = new URLSearchParams(window.location.search);
        const authToken = urlParams.get('token');
        
        let data;
        if (authToken) {
          // Exchange token for session
          console.log('🔑 Exchanging auth token...');
          data = await authApi.exchangeToken(authToken);
          // Clean up URL
          window.history.replaceState({}, '', window.location.pathname);
          if (!data.user) return;
        } else {
          // Normal auth check
          data = await authApi.getCurrentUser();
          if (!data.user) return;
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
      <div className="min-h-screen bg-gray-50 flex flex-col">
        {/* Header */}
        <header className="bg-white border-b border-gray-200 px-6 py-4">
          <div className="max-w-4xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
                <Icons.Package className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="font-bold text-gray-900">Order Pulse</h1>
                <p className="text-xs text-gray-500">Inventory Import Complete</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-500">{userProfile.email}</span>
              <button
                onClick={handleLogout}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                Logout
              </button>
            </div>
          </div>
        </header>

        {/* Success content */}
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="max-w-md text-center">
            <div className="w-20 h-20 mx-auto bg-green-100 rounded-full flex items-center justify-center mb-6">
              <Icons.CheckCircle2 className="w-10 h-10 text-green-500" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-3">
              Setup Complete!
            </h2>
            <p className="text-gray-600 mb-6">
              {importedItemCount > 0 
                ? `You've successfully imported ${importedItemCount} items to Arda.`
                : "Your inventory setup is complete."}
            </p>
            <div className="flex flex-col gap-3">
              <button
                onClick={handleOpenArda}
                className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
              >
                <Icons.ExternalLink className="w-5 h-5" />
                Open Arda
              </button>
              <button
                onClick={handleStartOver}
                className="w-full px-6 py-3 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200 transition-colors"
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
