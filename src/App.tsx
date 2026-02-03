import { useState, useEffect } from 'react';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './views/Dashboard';
import { InventoryView } from './views/InventoryView';
import { CadenceView } from './views/CadenceView';
import { ComposeEmail } from './views/ComposeEmail';
import { LoginScreen } from './views/LoginScreen';
import { JourneyView } from './views/JourneyView';
import { SupplierSetup } from './views/SupplierSetup';
import { ExtractedOrder, InventoryItem, GoogleUserProfile } from './types';
import { processOrdersToInventory } from './utils/inventoryLogic';
import { useAutoIngestion } from './hooks/useAutoIngestion';
import { authApi, ordersApi, InventoryItem as ApiInventoryItem, Order as ApiOrder } from './services/api';

// Convert ExtractedOrder to API Order format
const convertToApiOrder = (order: ExtractedOrder): Omit<ApiOrder, 'id' | 'user_id'> => ({
  original_email_id: order.originalEmailId,
  supplier: order.supplier,
  order_date: order.orderDate,
  total_amount: order.totalAmount || 0,
  confidence: order.confidence,
  items: order.items.map(item => ({
    id: item.id || '',
    name: item.name,
    quantity: item.quantity,
    unit: item.unit,
    unitPrice: item.unitPrice || 0,
    totalPrice: item.totalPrice || 0,
  })),
});

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
  const ingestion = useAutoIngestion(userProfile, handleOrdersProcessed);

  async function handleOrdersProcessed(newOrders: ExtractedOrder[]) {
    let newlyAdded: ExtractedOrder[] = [];

    setOrders(prev => {
      const existingKeys = new Set(prev.map(o => o.originalEmailId || o.id));
      const map = new Map<string, ExtractedOrder>();
      prev.forEach(o => map.set(o.originalEmailId || o.id, o));
      newOrders.forEach(o => {
        const key = o.originalEmailId || o.id;
        if (!map.has(key)) {
          newlyAdded.push(o);
        }
        map.set(key, o);
      });
      return Array.from(map.values());
    });

    // Persist only truly new orders to the backend (let the API generate UUIDs)
    if (newlyAdded.length > 0) {
      try {
        await ordersApi.saveOrders(
          newlyAdded.map(order => convertToApiOrder(order)) as ApiOrder[]
        );
        // Refresh inventory from server so cadence math stays consistent
        const invRes = await ordersApi.getInventory();
        setInventory(convertInventory(invRes.inventory));
        setHasCompletedSetup(true);
      } catch (err) {
        console.error('Failed to persist new orders:', err);
      }
    }
  }

  const convertInventory = (apiItems: ApiInventoryItem[]): InventoryItem[] => {
    return apiItems.map((item) => ({
      id: item.name,
      name: item.name,
      supplier: item.suppliers?.split(',')[0]?.trim() || 'Unknown',
      totalQuantityOrdered: item.totalQuantityOrdered,
      orderCount: item.orderCount,
      firstOrderDate: item.firstOrderDate,
      lastOrderDate: item.lastOrderDate,
      averageCadenceDays: item.averageCadenceDays,
      dailyBurnRate: item.dailyBurnRate,
      recommendedMin: item.recommendedMin,
      recommendedOrderQty: item.recommendedOrderQty,
      lastPrice: item.lastPrice,
      history: [],
    }));
  };

  // Check auth on mount and hydrate persisted orders/inventory
  useEffect(() => {
    const hydrate = async () => {
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

        // Load any persisted orders/inventory for continuity across refreshes
        try {
          const [{ orders: savedOrders }, invRes] = await Promise.all([
            ordersApi.getOrders(),
            ordersApi.getInventory(),
          ]);

          const convertedOrders: ExtractedOrder[] = savedOrders.map((o: any) => ({
            id: o.id,
            originalEmailId: o.original_email_id,
            supplier: o.supplier,
            orderDate: o.order_date,
            totalAmount: Number(o.total_amount) || 0,
            items: (o.items || []).map((item: any) => ({
              id: item.id,
              name: item.name,
              quantity: item.quantity,
              unit: item.unit || 'ea',
              unitPrice: item.unitPrice ?? item.unit_price ?? 0,
              totalPrice: item.totalPrice ?? item.total_price,
              sourceOrderId: o.id,
              sourceEmailId: o.original_email_id,
            })),
            confidence: Number(o.confidence) || 0,
          }));

          if (convertedOrders.length > 0) {
            setOrders(convertedOrders);
            setHasCompletedSetup(true);
            setActiveView('dashboard');
          }

          setInventory(convertInventory(invRes.inventory));
        } catch (err) {
          console.warn('Hydration failed (continuing without persisted data):', err);
        }

        // If no persisted data, fall back to localStorage flag
        if (!hasCompletedSetup) {
          const setupComplete = localStorage.getItem('orderPulse_setupComplete');
          if (setupComplete === 'true') {
            setHasCompletedSetup(true);
            setActiveView('dashboard');
          } else {
            setActiveView('setup');
          }
        }
      } catch {
        // Not authenticated
      } finally {
        setIsCheckingAuth(false);
      }
    };

    hydrate();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keyboard shortcuts for power users
  useEffect(() => {
    if (!userProfile) return;
    
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
    handleOrdersProcessed(newOrders);
    setHasCompletedSetup(true);
    localStorage.setItem('orderPulse_setupComplete', 'true');
    setActiveView('journey'); // Go to journey view to see results
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

  // Show login screen if not authenticated
  if (isCheckingAuth) {
    return <LoginScreen onCheckingAuth={true} />;
  }
  
  if (!userProfile) {
    return <LoginScreen />;
  }

  // Show supplier setup view if user hasn't completed setup yet
  if (!hasCompletedSetup && activeView === 'setup') {
    return (
      <div className="min-h-screen bg-arda-bg-secondary text-arda-text-primary font-sans">
        <div className="max-w-4xl mx-auto p-8">
          <SupplierSetup
            onScanComplete={handleSetupComplete}
            onSkip={handleSkipSetup}
          />
        </div>
      </div>
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
