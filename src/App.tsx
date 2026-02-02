import { useState, useEffect } from 'react';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './views/Dashboard';
import { InventoryView } from './views/InventoryView';
import { CadenceView } from './views/CadenceView';
import { ComposeEmail } from './views/ComposeEmail';
import { LoginScreen } from './views/LoginScreen';
// PipelineView available but not currently used in navigation
// import { PipelineView } from './views/PipelineView';
import { JourneyView } from './views/JourneyView';
import { SupplierSetup } from './views/SupplierSetup';
import { OnboardingFlow } from './views/OnboardingFlow';
import { MobileScanner } from './views/MobileScanner';
import { ExtractedOrder, InventoryItem, GoogleUserProfile } from './types';
import { processOrdersToInventory } from './utils/inventoryLogic';
import { useAutoIngestion } from './hooks/useAutoIngestion';
import { authApi } from './services/api';

export default function App() {
  const [activeView, setActiveView] = useState('setup'); // Start with supplier setup
  
  // Auth State
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [userProfile, setUserProfile] = useState<GoogleUserProfile | null>(null);
  
  // Data State
  const [orders, setOrders] = useState<ExtractedOrder[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  
  // Track if user has completed initial setup
  const [hasCompletedSetup, setHasCompletedSetup] = useState(false);
  
  // Email Draft State for integrated reordering
  const [emailDraft, setEmailDraft] = useState<{ to: string, subject: string, body: string } | null>(null);

  // Auto-ingestion hook
  const ingestion = useAutoIngestion(userProfile, (newOrders) => {
    setOrders(newOrders);
  });

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
          // Check if user has seen setup before (stored in localStorage)
          const setupComplete = localStorage.getItem('orderPulse_setupComplete');
          if (setupComplete === 'true') {
            setHasCompletedSetup(true);
            setActiveView('dashboard');
          } else {
            // New user or returning user who hasn't completed setup
            setActiveView('setup');
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

  // Keyboard shortcuts for power users
  useEffect(() => {
    if (!userProfile || activeView === 'pipeline') return;
    
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }
      
      switch (e.key) {
        case '1':
          setActiveView('dashboard');
          break;
        case '2':
          setActiveView('inventory');
          break;
        case '3':
          setActiveView('analysis');
          break;
        case '4':
          setActiveView('journey');
          break;
        case '5':
          setActiveView('compose');
          break;
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [userProfile, activeView]);

  // When orders update, recalculate inventory stats
  useEffect(() => {
    if (orders.length > 0) {
      const inv = processOrdersToInventory(orders);
      setInventory(inv);
    }
  }, [orders]);

  const handleReorder = (item: InventoryItem) => {
    const draft = {
      to: `${item.supplier.toLowerCase().replace(/\s+/g, '.')}@example.com`,
      subject: `Restock Request: ${item.name}`,
      body: `Hello ${item.supplier} Team,\n\nWe would like to place a restock order for the following item:\n\n- Item: ${item.name}\n- Quantity: ${item.recommendedOrderQty}\n\nPlease confirm availability and send over an updated invoice.\n\nBest regards,\n${userProfile?.name || 'Inventory Management'}`
    };
    setEmailDraft(draft);
    setActiveView('compose');
  };

  const handleUpdateInventoryItem = (id: string, updates: Partial<InventoryItem>) => {
    setInventory(prev => prev.map(item => 
      item.id === id ? { ...item, ...updates } : item
    ));
  };

  const handleLogout = async () => {
    try {
      await authApi.logout();
    } catch {
      // Ignore logout errors
    }
    setUserProfile(null);
    setOrders([]);
    setInventory([]);
    setHasCompletedSetup(false);
    localStorage.removeItem('orderPulse_setupComplete');
    setActiveView('setup');
  };

  const handleSetupComplete = (newOrders: ExtractedOrder[]) => {
    setOrders(prev => [...prev, ...newOrders]);
    setHasCompletedSetup(true);
    localStorage.setItem('orderPulse_setupComplete', 'true');
    setActiveView('journey'); // Go to journey view to see results
  };

  const handleOnboardingComplete = () => {
    // Convert reconciliation items to inventory items format
    // Sync to Arda is handled by OnboardingFlow, _items available for future use
    setHasCompletedSetup(true);
    localStorage.setItem('orderPulse_setupComplete', 'true');
    setActiveView('dashboard');
  };

  const handleSkipSetup = () => {
    setHasCompletedSetup(true);
    localStorage.setItem('orderPulse_setupComplete', 'true');
    setActiveView('dashboard');
  };

  const handleReset = async () => {
    // Clear local state
    setOrders([]);
    setInventory([]);
    setHasCompletedSetup(false);
    localStorage.removeItem('orderPulse_setupComplete');
    setActiveView('setup');
    
    // Trigger the ingestion hook to reset and restart
    await ingestion.resetAndRestart();
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

  // Show full onboarding flow if user hasn't completed setup yet
  if (!hasCompletedSetup && activeView === 'setup') {
    return (
      <OnboardingFlow
        onComplete={handleOnboardingComplete}
        onSkip={handleSkipSetup}
        userProfile={{ name: userProfile.name, email: userProfile.email }}
      />
    );
  }

  const renderView = () => {
    switch (activeView) {
      case 'dashboard':
        return (
          <Dashboard 
            orders={orders} 
            inventory={inventory} 
            onReorder={handleReorder}
          />
        );
      case 'inventory':
        return (
          <InventoryView 
            inventory={inventory} 
            onReorder={handleReorder}
            onUpdateItem={handleUpdateInventoryItem}
          />
        );
      case 'analysis':
        return <CadenceView inventory={inventory} />;
      case 'journey':
        return (
          <JourneyView
            orders={orders}
            inventory={inventory}
            onReorder={handleReorder}
          />
        );
      case 'compose':
        return (
          <ComposeEmail 
            gmailToken="" 
            isMockConnected={false} 
            prefill={emailDraft}
            onClearDraft={() => setEmailDraft(null)}
            apiKey=""
          />
        );
      case 'setup':
        return (
          <SupplierSetup
            onScanComplete={handleSetupComplete}
            onSkip={handleSkipSetup}
          />
        );
      default:
        return <Dashboard orders={orders} inventory={inventory} onReorder={handleReorder} />;
    }
  };

  return (
    <div className="min-h-screen bg-arda-bg-secondary text-arda-text-primary font-sans">
      <Sidebar 
        activeView={activeView} 
        onChangeView={setActiveView}
        userProfile={userProfile}
        onLogout={handleLogout}
        onReset={handleReset}
        isIngesting={ingestion.isIngesting}
        ingestionProgress={ingestion.progress}
      />
      <main className="pl-64">
        <div className="max-w-7xl mx-auto p-8">
          {renderView()}
        </div>
      </main>
    </div>
  );
}
