import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Icons } from '../components/Icons';
import { MOCK_EMAILS } from '../services/mockData';
import { authApi, analysisApi, jobsApi, amazonApi, API_BASE_URL } from '../services/api';
import { ExtractedOrder, ProcessingStatus, GoogleUserProfile, InventoryItem, ReviewStatus } from '../types';
import { InventoryView } from './InventoryView';
import { buildVelocityProfiles, normalizeItemName } from '../utils/inventoryLogic';

interface IngestionEngineProps {
  userProfile: GoogleUserProfile | null;
  setUserProfile: (user: GoogleUserProfile | null) => void;
  isMockConnected: boolean;
  setIsMockConnected: (isMock: boolean) => void;
  onOrdersProcessed: (orders: ExtractedOrder[]) => void;
}

interface EmailPreview {
  id: string;
  subject: string;
  sender: string;
  snippet?: string;
}

export const IngestionEngine: React.FC<IngestionEngineProps> = ({ 
  userProfile, setUserProfile,
  isMockConnected, setIsMockConnected,
  onOrdersProcessed 
}) => {
  const [isConnecting, setIsConnecting] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  
  const [processingStatus, setProcessingStatus] = useState<ProcessingStatus>({
    total: 0,
    processed: 0,
    success: 0,
    failed: 0,
    currentTask: 'Waiting to start...',
  });
  const [logs, setLogs] = useState<string[]>([]);
  
  // Job state
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [currentEmail, setCurrentEmail] = useState<EmailPreview | null>(null);
  const [processedOrders, setProcessedOrders] = useState<ExtractedOrder[]>([]);
  const [queueItems, setQueueItems] = useState<InventoryItem[]>([]);
  const [orderReview, setOrderReview] = useState<Record<string, ReviewStatus>>({});
  const [supplierReview, setSupplierReview] = useState<Record<string, ReviewStatus>>({});
  const [itemReview, setItemReview] = useState<Record<string, ReviewStatus>>({});
  const [amazonLookupLoadingIds, setAmazonLookupLoadingIds] = useState<Set<string>>(new Set());
  const [isProcessing, setIsProcessing] = useState(false);
  const [jobStatus, setJobStatus] = useState<'pending' | 'running' | 'completed' | 'failed' | null>(null);
  
  // Polling ref
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isConnected = !!userProfile || isMockConnected;

  const supplierKey = useCallback((name: string) => name.trim().toLowerCase(), []);

  const excludedItemIds = useMemo(() => (
    new Set(
      Object.entries(itemReview)
        .filter(([, status]) => status === 'excluded')
        .map(([id]) => id)
    )
  ), [itemReview]);

  const filteredOrders = useMemo(() => {
    return processedOrders
      .filter(order => {
        const orderStatus = orderReview[order.id] || 'pending';
        const supplierStatus = supplierReview[supplierKey(order.supplier)] || 'pending';
        return orderStatus !== 'excluded' && supplierStatus !== 'excluded';
      })
      .map(order => ({
        ...order,
        items: order.items.filter(item => {
          const key = item.normalizedName || normalizeItemName(item.name);
          return !excludedItemIds.has(key);
        }),
      }))
      .filter(order => order.items.length > 0);
  }, [processedOrders, orderReview, supplierReview, supplierKey, excludedItemIds]);

  const visibleQueueItems = useMemo(() => (
    queueItems.filter(item => item.isDraft !== false && (itemReview[item.id] || 'pending') !== 'excluded')
  ), [queueItems, itemReview]);

  useEffect(() => {
    onOrdersProcessed(filteredOrders);
  }, [filteredOrders, onOrdersProcessed]);

  const addLog = useCallback((msg: string) => setLogs(prev => {
    // Avoid duplicates
    if (prev[0]?.includes(msg.substring(10))) return prev;
    return [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev.slice(0, 99)];
  }), []);

  const buildQueueItemsFromOrders = useCallback((orders: ExtractedOrder[]): InventoryItem[] => {
    if (orders.length === 0) return [];
    const profiles = buildVelocityProfiles(orders);
    return Array.from(profiles.values()).map(profile => {
      const lastOrder = profile.orders[profile.orders.length - 1];
      return {
        id: profile.normalizedName,
        name: profile.displayName || profile.normalizedName,
        supplier: profile.supplier,
        asin: profile.asin,
        totalQuantityOrdered: profile.totalQuantityOrdered,
        orderCount: profile.orderCount,
        firstOrderDate: profile.firstOrderDate,
        lastOrderDate: profile.lastOrderDate,
        averageCadenceDays: Math.round(profile.averageCadenceDays),
        dailyBurnRate: Math.round(profile.dailyBurnRate * 100) / 100,
        recommendedMin: profile.recommendedMin,
        recommendedOrderQty: profile.recommendedOrderQty,
        lastPrice: lastOrder?.unitPrice || 0,
        history: profile.orders.map(order => ({ date: order.date, quantity: order.quantity })),
        imageUrl: profile.imageUrl,
        productUrl: profile.amazonUrl,
        isDraft: true,
      };
    });
  }, []);

  useEffect(() => {
    if (processedOrders.length === 0) return;
    setOrderReview(prev => {
      const next = { ...prev };
      processedOrders.forEach(order => {
        if (!next[order.id]) next[order.id] = 'pending';
      });
      return next;
    });
    setSupplierReview(prev => {
      const next = { ...prev };
      processedOrders.forEach(order => {
        const key = supplierKey(order.supplier);
        if (!next[key]) next[key] = 'pending';
      });
      return next;
    });
  }, [processedOrders, supplierKey]);

  useEffect(() => {
    if (filteredOrders.length === 0) return;
    const incoming = buildQueueItemsFromOrders(filteredOrders);
    setQueueItems(prev => {
      const prevMap = new Map(prev.map(item => [item.id, item]));
      const next = incoming.map(item => {
        const existing = prevMap.get(item.id);
        if (!existing) return item;
        return {
          ...item,
          name: existing.name ?? item.name,
          supplier: existing.supplier ?? item.supplier,
          location: existing.location ?? item.location,
          recommendedMin: existing.recommendedMin ?? item.recommendedMin,
          recommendedOrderQty: existing.recommendedOrderQty ?? item.recommendedOrderQty,
          color: existing.color ?? item.color,
          imageUrl: existing.imageUrl ?? item.imageUrl,
          productUrl: existing.productUrl ?? item.productUrl,
          asin: existing.asin ?? item.asin,
          isDraft: existing.isDraft ?? item.isDraft,
        };
      });
      const nextIds = new Set(next.map(item => item.id));
      const carry = prev.filter(item => !nextIds.has(item.id));
      const merged = [...next, ...carry];
      setItemReview(current => {
        const updated = { ...current };
        merged.forEach(item => {
          if (!updated[item.id]) updated[item.id] = 'pending';
        });
        return updated;
      });
      return merged;
    });
  }, [filteredOrders, buildQueueItemsFromOrders]);

  const handleQueueUpdate = useCallback((id: string, updates: Partial<InventoryItem>) => {
    setQueueItems(prev => prev.map(item => item.id === id ? { ...item, ...updates } : item));
  }, []);

  const handleItemReviewChange = useCallback((id: string, status: ReviewStatus) => {
    setItemReview(prev => ({ ...prev, [id]: status }));
  }, []);

  const handleOrderReviewChange = useCallback((orderId: string, status: ReviewStatus) => {
    setOrderReview(prev => ({ ...prev, [orderId]: status }));
  }, []);

  const handleSupplierReviewChange = useCallback((supplier: string, status: ReviewStatus) => {
    const key = supplierKey(supplier);
    setSupplierReview(prev => ({ ...prev, [key]: status }));
  }, [supplierKey]);

  const extractAsinFromUrl = (url: string): string | null => {
    const patterns = [
      /amazon\.com\/dp\/([A-Z0-9]{10})/i,
      /amazon\.com\/gp\/product\/([A-Z0-9]{10})/i,
      /amazon\.com\/.*\/dp\/([A-Z0-9]{10})/i,
    ];
    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) return match[1];
    }
    return null;
  };

  const parsePrice = (value?: string): number | null => {
    if (!value) return null;
    const parsed = parseFloat(value.replace(/[^0-9.]/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  };

  const handleAmazonLookup = useCallback(async (item: InventoryItem) => {
    const asin = item.asin || (item.productUrl ? extractAsinFromUrl(item.productUrl) : null);
    if (!asin) {
      addLog('⚠️ No ASIN found for this item. Add an Amazon URL or ASIN.');
      return;
    }

    setAmazonLookupLoadingIds(prev => new Set(prev).add(item.id));
    try {
      const result = await amazonApi.getItem(asin);
      const data = result.item;
      handleQueueUpdate(item.id, {
        asin: data.ASIN || asin,
        name: data.ItemName || item.name,
        originalName: data.ItemName || item.originalName,
        imageUrl: data.ImageURL || item.imageUrl,
        productUrl: data.AmazonURL || item.productUrl,
        lastPrice: parsePrice(data.Price) ?? item.lastPrice,
        amazonEnriched: {
          asin: data.ASIN || asin,
          itemName: data.ItemName || '',
          price: data.Price,
          imageUrl: data.ImageURL,
          amazonUrl: data.AmazonURL,
          unitCount: data.UnitCount,
          unitPrice: data.UnitPrice,
          upc: data.UPC,
        },
      });
      addLog(`✅ Amazon lookup complete for ${asin}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Amazon lookup failed';
      addLog(`❌ Amazon lookup failed: ${message}`);
    } finally {
      setAmazonLookupLoadingIds(prev => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  }, [addLog, handleQueueUpdate]);

  const reviewBadgeClasses: Record<ReviewStatus, string> = {
    pending: 'bg-yellow-50 text-yellow-700 border-yellow-200',
    approved: 'bg-green-50 text-green-700 border-green-200',
    excluded: 'bg-red-50 text-red-700 border-red-200',
  };

  const orderRows = useMemo(() => {
    return [...processedOrders].sort((a, b) => {
      return new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime();
    });
  }, [processedOrders]);

  const supplierRows = useMemo(() => {
    const map = new Map<string, { supplier: string; orderCount: number; itemCount: number; totalAmount: number }>();
    processedOrders.forEach(order => {
      const key = supplierKey(order.supplier);
      const existing = map.get(key) || { supplier: order.supplier, orderCount: 0, itemCount: 0, totalAmount: 0 };
      existing.orderCount += 1;
      existing.itemCount += order.items.length;
      existing.totalAmount += order.totalAmount || 0;
      map.set(key, existing);
    });
    return Array.from(map.values()).sort((a, b) => b.orderCount - a.orderCount);
  }, [processedOrders, supplierKey]);

  // Poll for job status
  const pollJobStatus = useCallback(async () => {
    if (!currentJobId) return;
    
    try {
      const status = await jobsApi.getStatus(currentJobId);
      
      if (!status.hasJob) {
        setIsProcessing(false);
        setJobStatus(null);
        return;
      }
      
      // Update state from job
      if (status.progress) {
        setProcessingStatus({
          total: status.progress.total,
          processed: status.progress.processed,
          success: status.progress.success,
          failed: status.progress.failed,
          currentTask: status.progress.currentTask,
        });
      }
      
      if (status.currentEmail) {
        setCurrentEmail(status.currentEmail);
      }
      
      if (status.orders) {
        const convertedOrders: ExtractedOrder[] = status.orders.map(o => ({
          id: o.id,
          originalEmailId: o.id,
          supplier: o.supplier,
          orderDate: o.orderDate,
          totalAmount: o.totalAmount,
          items: o.items,
          confidence: o.confidence,
        }));
        setProcessedOrders(convertedOrders);
      }
      
      if (status.logs) {
        setLogs(status.logs);
      }
      
      setJobStatus(status.status || null);
      
      // Stop polling if complete or failed
      if (status.status === 'completed' || status.status === 'failed') {
        setIsProcessing(false);
        setCurrentEmail(null);
        if (pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
        
        if (status.status === 'failed' && status.error) {
          addLog(`❌ Job failed: ${status.error}`);
        }
      }
    } catch (error) {
      console.error('Polling error:', error);
    }
  }, [currentJobId]);

  // Check for existing job on mount
  useEffect(() => {
    const checkExistingJob = async () => {
      if (!userProfile) return;
      
      try {
        const status = await jobsApi.getStatus();
        if (status.hasJob && status.jobId && (status.status === 'running' || status.status === 'pending')) {
          // Resume watching this job
          setCurrentJobId(status.jobId);
          setIsProcessing(true);
          setJobStatus(status.status);
          addLog('📋 Resuming existing job...');
        }
      } catch {
        // No existing job, that's fine
      }
    };
    
    if (!isCheckingAuth && userProfile) {
      checkExistingJob();
    }
  }, [isCheckingAuth, userProfile]);

  // Start/stop polling based on processing state
  useEffect(() => {
    if (isProcessing && currentJobId) {
      // Start polling every 1 second
      pollingRef.current = setInterval(pollJobStatus, 1000);
      // Also poll immediately
      pollJobStatus();
    }
    
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [isProcessing, currentJobId, pollJobStatus]);

  // Check for existing auth on mount and URL params
  useEffect(() => {
    const checkAuth = async () => {
      // Check URL for auth callback
      const params = new URLSearchParams(window.location.search);
      if (params.get('auth') === 'success') {
        addLog('✅ OAuth successful. Loading user profile...');
        window.history.replaceState({}, '', window.location.pathname);
      } else if (params.get('error')) {
        addLog(`❌ OAuth Error: ${params.get('error')}`);
        window.history.replaceState({}, '', window.location.pathname);
        setIsCheckingAuth(false);
        return;
      }

      // Check if user is already logged in
      try {
        const { user } = await authApi.getCurrentUser();
        setUserProfile({
          id: user.id,
          email: user.email,
          name: user.name,
          given_name: user.name.split(' ')[0],
          family_name: user.name.split(' ').slice(1).join(' ') || '',
          picture: user.picture_url,
        });
        addLog(`✅ Authenticated as ${user.name} (${user.email})`);
      } catch {
        // Not logged in, that's fine
      }
      setIsCheckingAuth(false);
    };
    
    checkAuth();
  }, [addLog, setUserProfile]);

  const handleAuthClick = () => {
    setIsConnecting(true);
    addLog('Redirecting to Google OAuth...');
    window.location.href = authApi.getLoginUrl();
  };

  const handleMockConnect = () => {
    setIsConnecting(true);
    setTimeout(() => {
      setIsMockConnected(true);
      setUserProfile(null);
      setIsConnecting(false);
      addLog('✅ Connected to Simulated Email Provider.');
      addLog('Connection Mode: MOCK DATA');
      addLog(`Found ${MOCK_EMAILS.length} recent messages matching query "subject:(order OR invoice OR receipt)"`);
      setProcessingStatus(prev => ({ ...prev, total: MOCK_EMAILS.length, currentTask: 'Ready to scan' }));
    }, 1000);
  };

  const handleDisconnect = async () => {
    // Stop any polling
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    
    try {
      await authApi.logout();
    } catch {
      // Ignore logout errors
    }
    setUserProfile(null);
    setIsMockConnected(false);
    addLog('Disconnected.');
    setProcessingStatus({ total: 0, processed: 0, success: 0, failed: 0, currentTask: 'Waiting to start...' });
    setProcessedOrders([]);
    setQueueItems([]);
    setOrderReview({});
    setSupplierReview({});
    setItemReview({});
    setAmazonLookupLoadingIds(new Set());
    setCurrentEmail(null);
    setCurrentJobId(null);
    setJobStatus(null);
  };

  const handleProcess = async () => {
    if (!isConnected) {
      alert('Please connect a data source first.');
      return;
    }

    // For real Gmail - use background jobs
    if (userProfile) {
      try {
        setIsProcessing(true);
        setProcessedOrders([]);
        setQueueItems([]);
        setOrderReview({});
        setSupplierReview({});
        setItemReview({});
        setAmazonLookupLoadingIds(new Set());
        setLogs([]);
        setProcessingStatus({ total: 0, processed: 0, success: 0, failed: 0, currentTask: 'Starting job...' });
        
        addLog('🚀 Starting background processing job...');
        const { jobId } = await jobsApi.startJob();
        setCurrentJobId(jobId);
        addLog(`📋 Job ${jobId.substring(0, 8)}... started`);
        
        // Polling will be started by the useEffect
      } catch (error) {
        addLog(`❌ Failed to start job: ${(error as Error).message}`);
        setIsProcessing(false);
      }
    } else {
      // Mock mode - process locally (unchanged)
      setIsProcessing(true);
      setProcessedOrders([]);
      setQueueItems([]);
      setOrderReview({});
      setSupplierReview({});
      setItemReview({});
      setAmazonLookupLoadingIds(new Set());
      setProcessingStatus(prev => ({ ...prev, currentTask: 'Initializing...', processed: 0, success: 0, failed: 0 }));
      
      const emailsToProcess = MOCK_EMAILS.map(e => ({
        id: e.id,
        subject: e.subject,
        sender: e.sender,
        body: e.body,
      }));
      
      setProcessingStatus(prev => ({ ...prev, total: emailsToProcess.length, currentTask: 'Starting analysis...' }));
      
      const allOrders: ExtractedOrder[] = [];
      let successCount = 0;
      let failCount = 0;
      let processedCount = 0;

      const processBatch = async (batch: typeof emailsToProcess, batchLabel: string) => {
        try {
          const { results } = await analysisApi.analyzeEmails(batch);
          
          for (const result of results) {
            processedCount++;
            const email = batch.find(e => e.id === result.emailId);
            
            if (email) {
              setCurrentEmail({
                id: email.id,
                subject: email.subject,
                sender: email.sender,
                snippet: email.body.substring(0, 100) + '...',
              });
            }
            
            if (result.isOrder && result.items && result.items.length > 0) {
              const order: ExtractedOrder = {
                id: result.emailId,
                originalEmailId: result.emailId,
                supplier: result.supplier || 'Unknown',
                orderDate: result.orderDate || new Date().toISOString().split('T')[0],
                totalAmount: result.totalAmount || 0,
                items: result.items.map((item, idx) => ({
                  id: `${result.emailId}-${idx}`,
                  name: item.name,
                  quantity: item.quantity,
                  unit: item.unit || 'ea',
                  unitPrice: item.unitPrice || 0,
                })),
                confidence: result.confidence,
              };
              allOrders.push(order);
              successCount++;
              addLog(`✅ Order: ${order.supplier} - $${(order.totalAmount ?? 0).toFixed(2)} (${order.items.length} items)`);
            } else if (result.isOrder) {
              successCount++;
              addLog(`⚠️ Order found but no items: ${email?.subject?.substring(0, 40)}...`);
            } else {
              failCount++;
            }
            
            setProcessingStatus(prev => ({
              ...prev,
              processed: processedCount,
              success: successCount,
              failed: failCount,
              currentTask: `${batchLabel}: ${processedCount}/${emailsToProcess.length}`,
            }));
          }
          
          setProcessedOrders([...allOrders]);
          
          return true;
        } catch (error) {
          addLog(`❌ Error in ${batchLabel}: ${(error as Error).message}`);
          return false;
        }
      };

      try {
        if (emailsToProcess.length > 0) {
          const firstEmail = emailsToProcess[0];
          setCurrentEmail({
            id: firstEmail.id,
            subject: firstEmail.subject,
            sender: firstEmail.sender,
            snippet: firstEmail.body.substring(0, 100) + '...',
          });
          addLog(`🔍 Analyzing first email: "${firstEmail.subject.substring(0, 50)}..."`);
          await processBatch([firstEmail], 'First email');
        }

        const BATCH_SIZE = 5;
        const remainingEmails = emailsToProcess.slice(1);
        
        if (remainingEmails.length > 0) {
          addLog(`📦 Processing ${remainingEmails.length} remaining emails in batches of ${BATCH_SIZE}...`);
          
          for (let i = 0; i < remainingEmails.length; i += BATCH_SIZE) {
            const batch = remainingEmails.slice(i, i + BATCH_SIZE);
            const batchNum = Math.floor(i / BATCH_SIZE) + 1;
            const totalBatches = Math.ceil(remainingEmails.length / BATCH_SIZE);
            
            setCurrentEmail({
              id: batch[0].id,
              subject: batch[0].subject,
              sender: batch[0].sender,
              snippet: batch[0].body.substring(0, 100) + '...',
            });
            
            addLog(`📧 Batch ${batchNum}/${totalBatches}: Analyzing ${batch.length} emails...`);
            await processBatch(batch, `Batch ${batchNum}/${totalBatches}`);
            
            if (i + BATCH_SIZE < remainingEmails.length) {
              await new Promise(resolve => setTimeout(resolve, 500));
            }
          }
        }

        setProcessingStatus({
          total: emailsToProcess.length,
          processed: emailsToProcess.length,
          success: successCount,
          failed: failCount,
          currentTask: '✅ Complete',
        });
        setCurrentEmail(null);
        addLog(`🎉 Pipeline Complete. ${successCount} orders identified.`);
        
      } catch (error) {
        addLog(`❌ Analysis Error: ${(error as Error).message}`);
        setProcessingStatus(prev => ({ ...prev, currentTask: 'Error' }));
      } finally {
        setIsProcessing(false);
      }
    }
  };

  if (isCheckingAuth) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-arda-text-secondary">
          <Icons.Loader2 className="w-6 h-6 animate-spin text-arda-accent" />
          <span>Checking authentication...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-arda-text-primary">Ingestion Engine</h2>
          <p className="text-arda-text-secondary">Connect Gmail and run AI extraction pipelines.</p>
        </div>
        <div className="flex items-center gap-4">
          {isProcessing && userProfile && (
            <div className="flex items-center gap-2 text-xs text-arda-success bg-green-50 px-3 py-1.5 rounded-full border border-green-200">
              <div className="w-2 h-2 bg-arda-success rounded-full animate-pulse" />
              Running in background
            </div>
          )}
          <div className="text-xs text-arda-text-muted">
            Backend: {API_BASE_URL}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        
        {/* Connection Panel */}
        <div className="bg-white border border-arda-border p-6 rounded-xl shadow-arda flex flex-col justify-center min-h-[300px]">
          <div className="flex flex-col items-center justify-center space-y-6">
            {!isConnected ? (
              <>
                <div className="text-center space-y-2">
                  <div className="w-16 h-16 bg-orange-50 rounded-full flex items-center justify-center mx-auto mb-4 border border-orange-100">
                    <Icons.Inbox className="w-8 h-8 text-arda-accent" />
                  </div>
                  <h3 className="text-xl font-bold text-arda-text-primary">Connect Data Source</h3>
                  <p className="text-arda-text-secondary text-sm max-w-xs mx-auto">
                    Sign in to scan your inbox for orders, or use simulated data for testing.
                  </p>
                  <p className="text-arda-text-muted text-xs">
                    ✓ Secure server-side OAuth • ✓ Background processing
                  </p>
                </div>
                
                <div className="flex flex-col gap-3 w-full max-w-xs items-center">
                  <button
                    onClick={handleAuthClick}
                    disabled={isConnecting}
                    className="w-full h-10 bg-white text-gray-600 rounded-md font-medium text-sm hover:bg-gray-50 flex items-center justify-center gap-3 transition-colors disabled:opacity-70 border border-gray-300 shadow-sm relative overflow-hidden"
                  >
                    <div className="absolute left-1 top-1 bottom-1 w-10 flex items-center justify-center bg-white rounded-l">
                       <svg version="1.1" xmlns="http://www.w3.org/2000/svg" width="18px" height="18px" viewBox="0 0 48 48">
                          <g>
                              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                              <path fill="none" d="M0 0h48v48H0z"></path>
                          </g>
                      </svg>
                    </div>
                    <span className="pl-6">Sign in with Google</span>
                  </button>
                  
                  <div className="flex items-center gap-2 w-full my-1">
                    <div className="h-px bg-arda-border flex-1"></div>
                    <span className="text-xs text-arda-text-muted uppercase">Or</span>
                    <div className="h-px bg-arda-border flex-1"></div>
                  </div>

                  <button
                    onClick={handleMockConnect}
                    disabled={isConnecting}
                    className="w-full bg-transparent border border-arda-border text-arda-text-muted px-4 py-2 rounded-md font-medium text-xs hover:text-arda-text-primary hover:border-arda-text-muted flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                  >
                    Use Demo Data
                  </button>
                </div>
              </>
            ) : (
              <div className="text-center w-full animate-in fade-in duration-500">
                <div className="relative mx-auto mb-4 w-20 h-20">
                  {userProfile?.picture ? (
                     <img src={userProfile.picture} alt="Profile" className="w-20 h-20 rounded-full border-4 border-arda-border" />
                  ) : (
                    <div className={`w-20 h-20 rounded-full flex items-center justify-center ${userProfile ? 'bg-red-500/10 text-red-500' : 'bg-blue-500/10 text-blue-500'}`}>
                      {userProfile ? <Icons.Inbox className="w-10 h-10" /> : <Icons.Package className="w-10 h-10" />}
                    </div>
                  )}
                  <div className="absolute bottom-0 right-0 bg-green-500 w-5 h-5 rounded-full border-4 border-white"></div>
                </div>
                
                <h3 className="text-xl font-bold text-arda-text-primary mb-1">
                  {userProfile ? `Welcome, ${userProfile.given_name}` : 'Mock Mode'}
                </h3>
                <p className="text-arda-text-muted text-sm mb-2">
                  {userProfile ? userProfile.email : 'Ready to analyze inventory patterns'}
                </p>
                {userProfile && (
                  <p className="text-green-500 text-xs mb-4">
                    ✓ Session persisted • ✓ Processing runs on server
                  </p>
                )}
                
                <button
                  onClick={handleDisconnect}
                  className="text-xs text-red-400 hover:text-red-300 border border-red-200 bg-red-500/10 px-4 py-2 rounded-full transition-colors"
                >
                  Sign Out
                </button>
              </div>
            )}
          </div>
        </div>

          {/* Status & Controls */}
          <div className="flex flex-col gap-4">
            {/* Action Card */}
            <div className="bg-white border border-arda-border rounded-xl shadow-arda p-6">
               <div className="flex justify-between items-center mb-4">
                 <div>
                   <h3 className="text-arda-text-primary font-semibold">Extraction Pipeline</h3>
                   <p className="text-xs text-arda-text-muted">
                      {userProfile ? 'Server-Side Background Processing' : 'Simulated Ingestion'}
                   </p>
                 </div>
                 <button
                    onClick={handleProcess}
                    disabled={!isConnected || isProcessing}
                    className="bg-arda-accent text-white px-6 py-2.5 rounded-lg font-medium text-sm hover:bg-arda-accent-hover flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-orange-500/20 transition-colors"
                  >
                    {isProcessing ? (
                      <Icons.Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Icons.RefreshCw className="w-4 h-4" />
                    )}
                    {isProcessing ? 'Processing...' : 'Start Analysis'}
                  </button>
               </div>
             
             {/* Current Email Visualization */}
             {currentEmail && (
               <div className="mb-4 p-3 bg-orange-50 border border-orange-100 rounded-lg animate-pulse">
                 <div className="flex items-start gap-3">
                   <div className="w-8 h-8 bg-arda-accent/10 rounded-full flex items-center justify-center flex-shrink-0">
                     <Icons.Mail className="w-4 h-4 text-arda-accent" />
                   </div>
                   <div className="flex-1 min-w-0">
                     <p className="text-xs text-arda-accent mb-0.5 font-medium">Analyzing...</p>
                     <p className="text-sm text-arda-text-primary font-medium truncate">{currentEmail.subject}</p>
                     <p className="text-xs text-arda-text-muted truncate">{currentEmail.sender}</p>
                   </div>
                 </div>
               </div>
             )}
             
             {/* Progress */}
             <div>
                <div className="flex justify-between text-xs text-arda-text-secondary font-mono mb-2">
                  <span>{processingStatus.currentTask}</span>
                  <span>{processingStatus.processed}/{processingStatus.total} ({Math.round(processingStatus.total ? (processingStatus.processed / processingStatus.total) * 100 : 0)}%)</span>
                </div>
                <div className="w-full bg-arda-bg-tertiary rounded-full h-3 mb-2 overflow-hidden border border-arda-border">
                  <div 
                    className="bg-gradient-to-r from-arda-accent to-orange-400 h-3 rounded-full transition-all duration-300 relative" 
                    style={{ width: `${processingStatus.total ? (processingStatus.processed / processingStatus.total) * 100 : 0}%` }}
                  >
                    {isProcessing && processingStatus.processed > 0 && (
                      <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-r from-transparent to-white/50 animate-pulse" />
                    )}
                  </div>
                </div>
                <div className="flex gap-4 text-xs">
                  <span className="text-arda-success font-medium">✓ {processingStatus.success} orders</span>
                  <span className="text-arda-text-muted">○ {processingStatus.failed} non-order</span>
                  {jobStatus && (
                    <span className={`ml-auto font-medium ${jobStatus === 'running' ? 'text-arda-info' : jobStatus === 'completed' ? 'text-arda-success' : 'text-arda-danger'}`}>
                      {jobStatus}
                    </span>
                  )}
                </div>
             </div>
          </div>

          {/* Live Results Preview */}
          {processedOrders.length > 0 && (
            <div className="bg-white border border-arda-border rounded-xl shadow-arda p-4">
              <div className="flex justify-between items-center mb-3">
                <h4 className="text-sm font-semibold text-arda-text-primary">Live Results</h4>
                <span className="text-xs text-arda-text-secondary bg-arda-bg-tertiary px-2 py-1 rounded-lg">{processedOrders.length} orders</span>
              </div>
              <div className="space-y-2 max-h-32 overflow-y-auto">
                {processedOrders.slice(-5).reverse().map((order, idx) => (
                  <div key={idx} className="flex items-center justify-between text-xs p-2 bg-arda-bg-secondary rounded-lg border border-arda-border">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 bg-green-50 rounded-full flex items-center justify-center">
                        <Icons.CheckCircle2 className="w-3 h-3 text-arda-success" />
                      </div>
                      <span className="text-arda-text-primary font-medium truncate max-w-[150px]">{order.supplier}</span>
                    </div>
                    <span className="text-arda-accent font-mono font-semibold">${(order.totalAmount ?? 0).toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Logs */}
          <div className="bg-arda-bg-tertiary border border-arda-border rounded-xl p-4 font-mono text-xs flex-1 overflow-y-auto min-h-[150px] max-h-[200px]">
            <div className="text-arda-text-secondary border-b border-arda-border pb-2 mb-2 sticky top-0 bg-arda-bg-tertiary flex justify-between">
              <span className="font-medium">System Logs</span>
              <span className="text-[10px] text-arda-text-muted cursor-pointer hover:text-arda-accent" onClick={() => setLogs([])}>Clear</span>
            </div>
            {logs.length === 0 && <span className="text-arda-text-muted italic mt-4 block text-center">System ready. Connect source to begin.</span>}
            {logs.map((log, idx) => (
              <div key={idx} className="mb-1.5 text-arda-text-secondary border-l-2 border-arda-accent/30 pl-2">
                {log}
              </div>
            ))}
          </div>
        </div>

      </div>

      {isConnected && (visibleQueueItems.length > 0 || isProcessing) && (
        <InventoryView
          inventory={visibleQueueItems}
          onUpdateItem={handleQueueUpdate}
          title="Item Review Queue"
          subtitle="Items appear here as they are detected. Edit fields, approve/exclude, and sync to Arda."
          showHistoryAction={false}
          showReorderAction={false}
          showReviewColumn={true}
          reviewStatusById={itemReview}
          onReviewStatusChange={handleItemReviewChange}
          showAmazonLookupAction={true}
          onAmazonLookup={handleAmazonLookup}
          amazonLookupLoadingIds={amazonLookupLoadingIds}
          emptyMessage="No items detected yet. Keep scanning to populate the queue."
        />
      )}

      {isConnected && (orderRows.length > 0 || supplierRows.length > 0) && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* Order Review */}
          <div className="bg-white border border-arda-border rounded-xl shadow-arda p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-arda-text-primary">Order Review</h3>
              <span className="text-xs text-arda-text-secondary bg-arda-bg-tertiary px-2 py-1 rounded-lg">
                {orderRows.length} orders
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-arda-bg-secondary border-b border-arda-border">
                  <tr className="text-arda-text-muted font-medium text-xs uppercase tracking-wide">
                    <th className="px-3 py-2 text-left min-w-[140px]">Supplier</th>
                    <th className="px-3 py-2 text-left w-24">Date</th>
                    <th className="px-3 py-2 text-right w-16">Items</th>
                    <th className="px-3 py-2 text-right w-20">Total</th>
                    <th className="px-3 py-2 text-left w-24">Status</th>
                    <th className="px-3 py-2 text-right w-32">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-arda-border">
                  {orderRows.map(order => {
                    const status = orderReview[order.id] || 'pending';
                    return (
                      <tr key={order.id} className="hover:bg-arda-bg-tertiary/50 transition-colors">
                        <td className="px-3 py-2">
                          <span className="text-arda-text-primary font-medium">{order.supplier}</span>
                        </td>
                        <td className="px-3 py-2 text-arda-text-secondary">
                          {order.orderDate}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-arda-text-secondary">
                          {order.items.length}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-arda-accent">
                          ${(order.totalAmount ?? 0).toFixed(2)}
                        </td>
                        <td className="px-3 py-2">
                          <span className={`text-[10px] px-2 py-0.5 rounded-full border ${reviewBadgeClasses[status]}`}>
                            {status.toUpperCase()}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => handleOrderReviewChange(order.id, status === 'approved' ? 'pending' : 'approved')}
                              className="text-xs px-2 py-1 rounded border border-green-200 text-green-700 hover:bg-green-50 transition-colors"
                              title="Approve order"
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              onClick={() => handleOrderReviewChange(order.id, status === 'excluded' ? 'pending' : 'excluded')}
                              className="text-xs px-2 py-1 rounded border border-red-200 text-red-700 hover:bg-red-50 transition-colors"
                              title="Exclude order"
                            >
                              Exclude
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Supplier Review */}
          <div className="bg-white border border-arda-border rounded-xl shadow-arda p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-arda-text-primary">Supplier Review</h3>
              <span className="text-xs text-arda-text-secondary bg-arda-bg-tertiary px-2 py-1 rounded-lg">
                {supplierRows.length} suppliers
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-arda-bg-secondary border-b border-arda-border">
                  <tr className="text-arda-text-muted font-medium text-xs uppercase tracking-wide">
                    <th className="px-3 py-2 text-left min-w-[140px]">Supplier</th>
                    <th className="px-3 py-2 text-right w-16">Orders</th>
                    <th className="px-3 py-2 text-right w-16">Items</th>
                    <th className="px-3 py-2 text-right w-20">Total</th>
                    <th className="px-3 py-2 text-left w-24">Status</th>
                    <th className="px-3 py-2 text-right w-32">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-arda-border">
                  {supplierRows.map(supplier => {
                    const status = supplierReview[supplierKey(supplier.supplier)] || 'pending';
                    return (
                      <tr key={supplierKey(supplier.supplier)} className="hover:bg-arda-bg-tertiary/50 transition-colors">
                        <td className="px-3 py-2">
                          <span className="text-arda-text-primary font-medium">{supplier.supplier}</span>
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-arda-text-secondary">
                          {supplier.orderCount}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-arda-text-secondary">
                          {supplier.itemCount}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-arda-accent">
                          ${supplier.totalAmount.toFixed(2)}
                        </td>
                        <td className="px-3 py-2">
                          <span className={`text-[10px] px-2 py-0.5 rounded-full border ${reviewBadgeClasses[status]}`}>
                            {status.toUpperCase()}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => handleSupplierReviewChange(supplier.supplier, status === 'approved' ? 'pending' : 'approved')}
                              className="text-xs px-2 py-1 rounded border border-green-200 text-green-700 hover:bg-green-50 transition-colors"
                              title="Approve supplier"
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              onClick={() => handleSupplierReviewChange(supplier.supplier, status === 'excluded' ? 'pending' : 'excluded')}
                              className="text-xs px-2 py-1 rounded border border-red-200 text-red-700 hover:bg-red-50 transition-colors"
                              title="Exclude supplier"
                            >
                              Exclude
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
