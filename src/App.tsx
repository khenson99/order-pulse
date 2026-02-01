import { useState, useEffect } from 'react';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './views/Dashboard';
import { InventoryView } from './views/InventoryView';
import { CadenceView } from './views/CadenceView';
import { ComposeEmail } from './views/ComposeEmail';
import { LoginScreen } from './views/LoginScreen';
import { PipelineView } from './views/PipelineView';
import { ExtractedOrder, InventoryItem, GoogleUserProfile } from './types';
import { processOrdersToInventory } from './utils/inventoryLogic';
import { useAutoIngestion } from './hooks/useAutoIngestion';
import { authApi } from './services/api';

export default function App() {
  const [activeView, setActiveView] = useState('pipeline'); // Start with pipeline view
  
  // Auth State
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [userProfile, setUserProfile] = useState<GoogleUserProfile | null>(null);
  
  // Data State
  const [orders, setOrders] = useState<ExtractedOrder[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  
  // Track if pipeline has been viewed
  const [hasSeenPipeline, setHasSeenPipeline] = useState(false);
  
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
          // If user is already logged in and has data, skip pipeline
          setHasSeenPipeline(true);
          setActiveView('dashboard');
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
    setHasSeenPipeline(false);
    setActiveView('pipeline');
  };

  const handleContinueToDashboard = () => {
    setHasSeenPipeline(true);
    setActiveView('dashboard');
  };

  // Show login screen if not authenticated
  if (isCheckingAuth) {
    return <LoginScreen onCheckingAuth={true} />;
  }
  
  if (!userProfile) {
    return <LoginScreen />;
  }

  // Show pipeline view while ingesting or if user hasn't seen it yet
  if (activeView === 'pipeline' || (!hasSeenPipeline && (ingestion.isIngesting || orders.length === 0))) {
    return (
      <PipelineView
        isIngesting={ingestion.isIngesting}
        progress={ingestion.progress}
        currentEmail={ingestion.currentEmail}
        orders={orders}
        inventory={inventory}
        logs={ingestion.logs}
        onContinueToDashboard={handleContinueToDashboard}
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
