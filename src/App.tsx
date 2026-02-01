import { useState, useEffect } from 'react';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './views/Dashboard';
import { InventoryView } from './views/InventoryView';
import { CadenceView } from './views/CadenceView';
import { ComposeEmail } from './views/ComposeEmail';
import { LoginScreen } from './views/LoginScreen';
import { ExtractedOrder, InventoryItem, GoogleUserProfile } from './types';
import { processOrdersToInventory } from './utils/inventoryLogic';
import { useAutoIngestion } from './hooks/useAutoIngestion';
import { authApi } from './services/api';

export default function App() {
  const [activeView, setActiveView] = useState('dashboard');
  
  // Auth State
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [userProfile, setUserProfile] = useState<GoogleUserProfile | null>(null);
  
  // Data State
  const [orders, setOrders] = useState<ExtractedOrder[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  
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
    if (!userProfile) return; // Only when logged in
    
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
  }, [userProfile]);

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
  };

  // Show login screen if not authenticated
  if (isCheckingAuth) {
    return <LoginScreen onCheckingAuth={true} />;
  }
  
  if (!userProfile) {
    return <LoginScreen />;
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
