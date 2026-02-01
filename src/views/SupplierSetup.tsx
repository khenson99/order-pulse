import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Icons } from '../components/Icons';
import { ExtractedOrder } from '../types';
import { discoverApi, jobsApi, JobStatus, DiscoveredSupplier } from '../services/api';
import { mergeSuppliers } from '../utils/supplierUtils';
import {
  buildSupplierGridItems,
  calculateProgressPercent,
  getMilestoneMessage,
  MILESTONES,
  OTHER_PRIORITY_SUPPLIERS,
  PRIORITY_SUPPLIER_DOMAINS,
} from './supplierSetupUtils';

interface SupplierSetupProps {
  onScanComplete: (orders: ExtractedOrder[]) => void;
  onSkip: () => void;
}

export const SupplierSetup: React.FC<SupplierSetupProps> = ({
  onScanComplete,
  onSkip,
}) => {
  // Onboarding phase states
  const [showWelcome, setShowWelcome] = useState(true);
  const [celebratingMilestone, setCelebratingMilestone] = useState<string | null>(null);
  const [achievedMilestones, setAchievedMilestones] = useState<Set<string>>(new Set());
  const [showInsights, setShowInsights] = useState(false);

  // Amazon processing state (starts immediately)
  const [amazonJobId, setAmazonJobId] = useState<string | null>(null);
  const [amazonStatus, setAmazonStatus] = useState<JobStatus | null>(null);
  const [amazonOrders, setAmazonOrders] = useState<ExtractedOrder[]>([]);
  const [amazonError, setAmazonError] = useState<string | null>(null);
  const [isAmazonComplete, setIsAmazonComplete] = useState(false);
  const amazonPollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Priority suppliers (McMaster-Carr, Uline) processing state (starts immediately)
  const [priorityJobId, setPriorityJobId] = useState<string | null>(null);
  const [priorityStatus, setPriorityStatus] = useState<JobStatus | null>(null);
  const [priorityOrders, setPriorityOrders] = useState<ExtractedOrder[]>([]);
  const [priorityError, setPriorityError] = useState<string | null>(null);
  const [isPriorityComplete, setIsPriorityComplete] = useState(false);
  const priorityPollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Discovery state (runs in parallel)
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [discoveryProgress, setDiscoveryProgress] = useState<string>('');
  const [discoveredSuppliers, setDiscoveredSuppliers] = useState<DiscoveredSupplier[]>([]);
  const [enabledSuppliers, setEnabledSuppliers] = useState<Set<string>>(
    new Set(['mcmaster.com', 'uline.com'])
  );
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [hasDiscovered, setHasDiscovered] = useState(false);

  // Other suppliers scanning state
  const [isScanning, setIsScanning] = useState(false);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [otherOrders, setOtherOrders] = useState<ExtractedOrder[]>([]);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Computed values for the experience
  const allItems = useMemo(() => {
    const items: Array<{ name: string; price: number; supplier: string; image?: string; date: string }> = [];
    
    amazonOrders.forEach(order => {
      order.items.forEach(item => {
        items.push({
          name: item.amazonEnriched?.itemName || item.name,
          price: item.unitPrice || 0,
          supplier: 'Amazon',
          image: item.amazonEnriched?.imageUrl,
          date: order.orderDate,
        });
      });
    });
    
    priorityOrders.forEach(order => {
      order.items.forEach(item => {
        items.push({
          name: item.name,
          price: item.unitPrice || 0,
          supplier: order.supplier,
          date: order.orderDate,
        });
      });
    });
    
    otherOrders.forEach(order => {
      order.items.forEach(item => {
        items.push({
          name: item.name,
          price: item.unitPrice || 0,
          supplier: order.supplier,
          date: order.orderDate,
        });
      });
    });
    
    return items;
  }, [amazonOrders, priorityOrders, otherOrders]);

  const totalSpend = useMemo(() => {
    return allItems.reduce((sum, item) => sum + (item.price || 0), 0);
  }, [allItems]);

  const combinedOrders = useMemo(() => {
    return [...amazonOrders, ...priorityOrders, ...otherOrders];
  }, [amazonOrders, priorityOrders, otherOrders]);

  const totalOrders = combinedOrders.length;
  const uniqueSuppliers = useMemo(() => {
    const suppliers = new Set<string>();
    allItems.forEach(item => suppliers.add(item.supplier));
    return suppliers.size;
  }, [allItems]);

  // Merge priority suppliers with discovered ones (excluding Amazon)
  const allSuppliers = useMemo(() => mergeSuppliers(OTHER_PRIORITY_SUPPLIERS, discoveredSuppliers), [discoveredSuppliers]);

  // Check for milestone achievements
  useEffect(() => {
    const newMilestones = new Set(achievedMilestones);
    
    if (allItems.length >= MILESTONES.firstItem && !achievedMilestones.has('firstItem')) {
      newMilestones.add('firstItem');
      setCelebratingMilestone('firstItem');
      setTimeout(() => setCelebratingMilestone(null), 2000);
    }
    
    if (allItems.length >= MILESTONES.tenItems && !achievedMilestones.has('tenItems')) {
      newMilestones.add('tenItems');
      setCelebratingMilestone('tenItems');
      setTimeout(() => setCelebratingMilestone(null), 2000);
    }
    
    if (allItems.length >= MILESTONES.fiftyItems && !achievedMilestones.has('fiftyItems')) {
      newMilestones.add('fiftyItems');
      setCelebratingMilestone('fiftyItems');
      setTimeout(() => setCelebratingMilestone(null), 2500);
    }
    
    if (newMilestones.size !== achievedMilestones.size) {
      setAchievedMilestones(newMilestones);
    }
  }, [allItems.length, achievedMilestones]);

  // Hide welcome after processing starts
  useEffect(() => {
    if (amazonJobId || priorityJobId) {
      const timer = setTimeout(() => setShowWelcome(false), 1500);
      return () => clearTimeout(timer);
    }
  }, [amazonJobId, priorityJobId]);

  // 1. START ALL PRIORITY SUPPLIERS IMMEDIATELY ON MOUNT
  useEffect(() => {
    // Start Amazon (ASIN extraction + Product Advertising API)
    const startAmazon = async () => {
      try {
        console.log('🛒 Starting Amazon processing immediately...');
        const response = await jobsApi.startAmazon();
        setAmazonJobId(response.jobId);
      } catch (error: any) {
        console.error('Failed to start Amazon processing:', error);
        setAmazonError(error.message || 'Failed to start Amazon processing');
      }
    };
    
    // Start McMaster-Carr and Uline (AI extraction)
    const startPrioritySuppliers = async () => {
      try {
        console.log('🏭 Starting McMaster-Carr & Uline processing immediately...');
        const response = await jobsApi.startJob(['mcmaster.com', 'uline.com']);
        setPriorityJobId(response.jobId);
      } catch (error: any) {
        console.error('Failed to start priority suppliers:', error);
        setPriorityError(error.message || 'Failed to start McMaster-Carr & Uline');
      }
    };
    
    // Start both in parallel
    startAmazon();
    startPrioritySuppliers();
  }, []);

  // 2. START SUPPLIER DISCOVERY IN PARALLEL (for other suppliers)
  useEffect(() => {
    if (!hasDiscovered && !isDiscovering) {
      handleDiscoverSuppliers();
    }
  }, []);

  // Poll Amazon job status
  const pollAmazonStatus = useCallback(async () => {
    if (!amazonJobId) return;
    
    try {
      const status = await jobsApi.getStatus(amazonJobId);
      setAmazonStatus(status);
      
      if (status.orders && status.orders.length > 0) {
        const convertedOrders: ExtractedOrder[] = status.orders.map(o => ({
          id: o.id,
          originalEmailId: o.id,
          supplier: o.supplier,
          orderDate: o.orderDate,
          totalAmount: o.totalAmount,
          items: o.items,
          confidence: o.confidence,
        }));
        setAmazonOrders(convertedOrders);
      }
      
      if (status.status === 'completed' || status.status === 'failed') {
        setIsAmazonComplete(true);
        if (amazonPollingRef.current) {
          clearInterval(amazonPollingRef.current);
          amazonPollingRef.current = null;
        }
      }
    } catch (error) {
      console.error('Amazon polling error:', error);
    }
  }, [amazonJobId]);

  useEffect(() => {
    if (amazonJobId && !isAmazonComplete) {
      pollAmazonStatus();
      amazonPollingRef.current = setInterval(pollAmazonStatus, 1000);
      return () => {
        if (amazonPollingRef.current) {
          clearInterval(amazonPollingRef.current);
          amazonPollingRef.current = null;
        }
      };
    }
  }, [amazonJobId, isAmazonComplete, pollAmazonStatus]);

  // Poll Priority Suppliers (McMaster-Carr, Uline) job status
  const pollPriorityStatus = useCallback(async () => {
    if (!priorityJobId) return;
    
    try {
      const status = await jobsApi.getStatus(priorityJobId);
      setPriorityStatus(status);
      
      if (status.orders && status.orders.length > 0) {
        const convertedOrders: ExtractedOrder[] = status.orders.map(o => ({
          id: o.id,
          originalEmailId: o.id,
          supplier: o.supplier,
          orderDate: o.orderDate,
          totalAmount: o.totalAmount,
          items: o.items,
          confidence: o.confidence,
        }));
        setPriorityOrders(convertedOrders);
      }
      
      if (status.status === 'completed' || status.status === 'failed') {
        setIsPriorityComplete(true);
        if (priorityPollingRef.current) {
          clearInterval(priorityPollingRef.current);
          priorityPollingRef.current = null;
        }
      }
    } catch (error) {
      console.error('Priority polling error:', error);
    }
  }, [priorityJobId]);

  useEffect(() => {
    if (priorityJobId && !isPriorityComplete) {
      pollPriorityStatus();
      priorityPollingRef.current = setInterval(pollPriorityStatus, 1000);
      return () => {
        if (priorityPollingRef.current) {
          clearInterval(priorityPollingRef.current);
          priorityPollingRef.current = null;
        }
      };
    }
  }, [priorityJobId, isPriorityComplete, pollPriorityStatus]);

  // Discover suppliers
  const handleDiscoverSuppliers = async () => {
    setIsDiscovering(true);
    setDiscoverError(null);
    setDiscoveryProgress('Scanning your inbox for suppliers...');
    
    try {
      const result = await discoverApi.discoverSuppliers();
      // Filter out Amazon since we handle it separately
      const nonAmazonSuppliers = result.suppliers.filter((s: DiscoveredSupplier) => !s.domain.includes('amazon'));
      setDiscoveredSuppliers(nonAmazonSuppliers);
      setHasDiscovered(true);
      setDiscoveryProgress('');
    } catch (err: any) {
      console.error('Discovery error:', err);
      setDiscoverError(err.message || 'Failed to discover suppliers');
    } finally {
      setIsDiscovering(false);
    }
  };

  // Poll job status
  const pollJobStatus = useCallback(async () => {
    if (!currentJobId) return;
    
    try {
      const status = await jobsApi.getStatus(currentJobId);
      setJobStatus(status);
      
      if (status.orders && status.orders.length > 0) {
        const convertedOrders: ExtractedOrder[] = status.orders.map(o => ({
          id: o.id,
          originalEmailId: o.id,
          supplier: o.supplier,
          orderDate: o.orderDate,
          totalAmount: o.totalAmount,
          items: o.items,
          confidence: o.confidence,
        }));
        setOtherOrders(convertedOrders);
      }
      
      if (status.status === 'completed' || status.status === 'failed') {
        setIsScanning(false);
        if (pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
      }
    } catch (error) {
      console.error('Job polling error:', error);
    }
  }, [currentJobId]);

  useEffect(() => {
    if (currentJobId && isScanning) {
      pollJobStatus();
      pollingRef.current = setInterval(pollJobStatus, 1000);
      return () => {
        if (pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
      };
    }
  }, [currentJobId, isScanning, pollJobStatus]);

  // Scan selected suppliers
  const handleScanSuppliers = useCallback(async () => {
    // Filter to only non-Amazon, non-priority enabled suppliers
    const domainsToScan = Array.from(enabledSuppliers).filter(
      d => !d.includes('amazon') && !PRIORITY_SUPPLIER_DOMAINS.has(d)
    );
    
    if (domainsToScan.length === 0) {
      return; // Nothing additional to scan
    }
    
    setIsScanning(true);
    setJobStatus(null);
    
    try {
      const response = await jobsApi.startJob(domainsToScan);
      setCurrentJobId(response.jobId);
    } catch (error: any) {
      console.error('Scan error:', error);
      setIsScanning(false);
    }
  }, [enabledSuppliers]);

  const handleToggleSupplier = useCallback((domain: string) => {
    setEnabledSuppliers(prev => {
      const next = new Set(prev);
      if (next.has(domain)) {
        next.delete(domain);
      } else {
        next.add(domain);
      }
      return next;
    });
  }, []);

  const handleComplete = useCallback(() => {
    onScanComplete(combinedOrders);
  }, [combinedOrders, onScanComplete]);

  const supplierCount = allSuppliers.length;
  const enabledCount = enabledSuppliers.size;
  const isPriorityProcessing = useMemo(
    () => Boolean(!isPriorityComplete && priorityJobId),
    [isPriorityComplete, priorityJobId],
  );
  const isAnyProcessing = useMemo(
    () => Boolean((!isAmazonComplete && amazonJobId) || isPriorityProcessing || isScanning),
    [isAmazonComplete, amazonJobId, isPriorityProcessing, isScanning],
  );
  const milestoneMessage = useMemo(
    () => (celebratingMilestone ? getMilestoneMessage(celebratingMilestone) : null),
    [celebratingMilestone],
  );
  
  // Priority suppliers progress
  const priorityProgress = priorityStatus?.progress;
  const priorityProgressPercent = useMemo(
    () => calculateProgressPercent(priorityProgress),
    [priorityProgress],
  );

  // Amazon progress
  const amazonProgress = amazonStatus?.progress;
  const amazonProgressPercent = useMemo(
    () => calculateProgressPercent(amazonProgress),
    [amazonProgress],
  );

  const supplierGridItems = useMemo(
    () => buildSupplierGridItems(allSuppliers, enabledSuppliers),
    [allSuppliers, enabledSuppliers],
  );

  return (
    <div className="max-w-5xl mx-auto p-6 pb-32 space-y-6 relative">
      
      {/* Milestone Celebration Overlay */}
      {milestoneMessage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
          <div className="bg-white rounded-2xl shadow-2xl p-8 text-center animate-bounce-in border-4 border-arda-accent">
            <div className="text-6xl mb-4">{milestoneMessage.emoji}</div>
            <h2 className="text-2xl font-bold text-arda-text-primary mb-2">
              {milestoneMessage.title}
            </h2>
            <p className="text-arda-text-secondary">
              {milestoneMessage.subtitle}
            </p>
          </div>
          {/* Confetti effect */}
          <div className="absolute inset-0 overflow-hidden">
            {[...Array(20)].map((_, i) => (
              <div
                key={i}
                className="absolute animate-confetti"
                style={{
                  left: `${Math.random() * 100}%`,
                  animationDelay: `${Math.random() * 0.5}s`,
                  backgroundColor: ['#10B981', '#3B82F6', '#F59E0B', '#EF4444', '#8B5CF6'][i % 5],
                  width: '10px',
                  height: '10px',
                  borderRadius: '2px',
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Welcome Header - Animated intro */}
      {showWelcome && (
        <div className="text-center py-8 animate-fade-in">
          <div className="inline-flex items-center gap-2 bg-arda-accent/10 text-arda-accent px-4 py-2 rounded-full text-sm font-medium mb-4">
            <Icons.Sparkles className="w-4 h-4" />
            Welcome to Arda
          </div>
          <h1 className="text-3xl font-bold text-arda-text-primary mb-3">
            Let's discover your supply chain
          </h1>
          <p className="text-arda-text-secondary max-w-lg mx-auto">
            We're scanning your emails to find orders, track spending, and identify 
            replenishment patterns. This usually takes about 30 seconds.
          </p>
        </div>
      )}

      {/* Live Stats Bar - The "wow" moment */}
      {(allItems.length > 0 || totalOrders > 0) && (
        <div className="bg-gradient-to-r from-arda-accent to-blue-600 rounded-2xl p-6 text-white shadow-lg">
          <div className="grid grid-cols-4 gap-6 text-center">
            <div>
              <div className="text-4xl font-bold">{allItems.length}</div>
              <div className="text-white/80 text-sm">Items Found</div>
            </div>
            <div>
              <div className="text-4xl font-bold">{totalOrders}</div>
              <div className="text-white/80 text-sm">Orders</div>
            </div>
            <div>
              <div className="text-4xl font-bold">{uniqueSuppliers}</div>
              <div className="text-white/80 text-sm">Suppliers</div>
            </div>
            <div>
              <div className="text-4xl font-bold">
                ${totalSpend >= 1000 ? `${(totalSpend / 1000).toFixed(1)}k` : totalSpend.toFixed(0)}
              </div>
              <div className="text-white/80 text-sm">Tracked</div>
            </div>
          </div>
          
          {/* Value teaser */}
          {allItems.length >= 5 && (
            <div className="mt-4 pt-4 border-t border-white/20 text-center">
              <p className="text-white/90 text-sm">
                💡 <span className="font-medium">Insight preview:</span> We're already seeing patterns in your ordering. 
                Set up Kanban cards to automate replenishment.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Header when not showing welcome */}
      {!showWelcome && (
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-arda-text-primary">Importing Your Orders</h1>
            <p className="text-arda-text-secondary mt-1">
              {isAnyProcessing 
                ? 'Discovering items from your suppliers...'
                : 'Ready to set up your inventory'}
            </p>
          </div>
          {!isAnyProcessing && allItems.length > 0 && (
            <button
              onClick={handleComplete}
              className="bg-arda-accent hover:bg-blue-600 text-white px-6 py-3 rounded-xl font-semibold transition-all shadow-lg hover:shadow-xl flex items-center gap-2"
            >
              Continue to Dashboard
              <Icons.ArrowRight className="w-5 h-5" />
            </button>
          )}
        </div>
      )}

      {/* Amazon Processing Card - Premium look */}
      <div className={`border-2 rounded-2xl p-6 transition-all ${
        amazonError
          ? 'bg-red-50 border-red-200'
          : isAmazonComplete 
            ? amazonOrders.length > 0
              ? 'bg-green-50 border-green-300 shadow-md' 
              : 'bg-gray-50 border-gray-200'
            : 'bg-orange-50 border-orange-200 shadow-sm'
      }`}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-4">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
              isAmazonComplete ? 'bg-green-500' : 'bg-orange-500'
            }`}>
              {amazonError ? (
                <Icons.AlertCircle className="w-6 h-6 text-white" />
              ) : !isAmazonComplete ? (
                <Icons.Loader2 className="w-6 h-6 text-white animate-spin" />
              ) : (
                <Icons.CheckCircle2 className="w-6 h-6 text-white" />
              )}
            </div>
            <div>
              <h3 className="text-xl font-bold text-arda-text-primary">Amazon</h3>
              <p className={`text-sm ${amazonError ? 'text-red-600' : 'text-arda-text-secondary'}`}>
                {amazonError 
                  ? amazonError
                  : !isAmazonComplete 
                    ? 'Extracting products from your orders...'
                    : amazonOrders.length > 0 
                      ? `${amazonOrders.reduce((sum, o) => sum + o.items.length, 0)} items from ${amazonOrders.length} orders`
                      : 'No Amazon orders found'
                }
              </p>
            </div>
          </div>
          
          {amazonProgress && !isAmazonComplete && !amazonError && (
            <div className="text-right">
              <div className="text-2xl font-bold text-orange-600">
                {Math.round(amazonProgressPercent)}%
              </div>
              <div className="text-xs text-arda-text-muted">
                {amazonProgress.processed} / {amazonProgress.total} emails
              </div>
            </div>
          )}
        </div>

        {/* Amazon Progress Bar */}
        {!isAmazonComplete && amazonProgress && !amazonError && (
          <div className="mb-4">
            <div className="h-3 bg-orange-100 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-orange-500 to-orange-400 transition-all duration-300 rounded-full"
                style={{ width: `${amazonProgressPercent}%` }}
              />
            </div>
          </div>
        )}

        {/* Amazon Items Grid - Show all items beautifully */}
        {amazonOrders.length > 0 && (
          <div className="max-h-64 overflow-y-auto">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {amazonOrders.flatMap((order, orderIdx) => 
                order.items.map((item, itemIdx) => (
                  <div 
                    key={`${orderIdx}-${itemIdx}`} 
                    className="bg-white border border-gray-200 rounded-xl p-3 flex items-center gap-3 hover:shadow-md transition-shadow"
                  >
                    {item.amazonEnriched?.imageUrl ? (
                      <img 
                        src={item.amazonEnriched.imageUrl} 
                        alt="" 
                        className="w-14 h-14 object-contain flex-shrink-0 rounded-lg bg-gray-50"
                      />
                    ) : (
                      <div className="w-14 h-14 bg-orange-50 rounded-lg flex items-center justify-center flex-shrink-0">
                        <Icons.Package className="w-7 h-7 text-orange-400" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-arda-text-primary line-clamp-2">
                        {item.amazonEnriched?.itemName || item.name}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        {(item.unitPrice ?? 0) > 0 && (
                          <span className="text-sm text-green-600 font-bold">
                            ${(item.unitPrice ?? 0).toFixed(2)}
                          </span>
                        )}
                        <span className="text-xs text-arda-text-muted">
                          {order.orderDate}
                        </span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* McMaster-Carr & Uline Card */}
      <div className={`border-2 rounded-2xl p-6 transition-all ${
        priorityError
          ? 'bg-red-50 border-red-200'
          : isPriorityComplete 
            ? priorityOrders.length > 0 
              ? 'bg-green-50 border-green-300 shadow-md' 
              : 'bg-gray-50 border-gray-200'
            : 'bg-blue-50 border-blue-200 shadow-sm'
      }`}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-4">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
              isPriorityComplete ? 'bg-green-500' : 'bg-blue-500'
            }`}>
              {priorityError ? (
                <Icons.AlertCircle className="w-6 h-6 text-white" />
              ) : !isPriorityComplete ? (
                <Icons.Loader2 className="w-6 h-6 text-white animate-spin" />
              ) : (
                <Icons.CheckCircle2 className="w-6 h-6 text-white" />
              )}
            </div>
            <div>
              <h3 className="text-xl font-bold text-arda-text-primary">Industrial Suppliers</h3>
              <p className="text-sm text-arda-text-secondary">
                McMaster-Carr, Uline, and more
              </p>
            </div>
          </div>
          
          {priorityProgress && !isPriorityComplete && !priorityError && (
            <div className="text-right">
              <div className="text-2xl font-bold text-blue-600">
                {Math.round(priorityProgressPercent)}%
              </div>
              <div className="text-xs text-arda-text-muted">
                {priorityProgress.processed} / {priorityProgress.total} emails
              </div>
            </div>
          )}
        </div>

        {/* Progress Bar */}
        {!isPriorityComplete && priorityProgress && !priorityError && (
          <div className="mb-4">
            <div className="h-3 bg-blue-100 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-blue-500 to-blue-400 transition-all duration-300 rounded-full"
                style={{ width: `${priorityProgressPercent}%` }}
              />
            </div>
          </div>
        )}

        {/* Priority Items List */}
        {priorityOrders.length > 0 && (
          <div className="max-h-48 overflow-y-auto">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {priorityOrders.flatMap((order, orderIdx) => 
                order.items.map((item, itemIdx) => (
                  <div 
                    key={`${orderIdx}-${itemIdx}`} 
                    className="bg-white border border-gray-200 rounded-xl p-3 flex items-center gap-3"
                  >
                    <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center flex-shrink-0">
                      <Icons.Package className="w-5 h-5 text-blue-500" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-arda-text-primary line-clamp-1">
                        {item.name}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        {(item.unitPrice ?? 0) > 0 && (
                          <span className="text-sm text-blue-600 font-bold">
                            ${(item.unitPrice ?? 0).toFixed(2)}
                          </span>
                        )}
                        {item.quantity > 1 && (
                          <span className="text-xs text-arda-text-muted bg-gray-100 px-1.5 py-0.5 rounded">
                            x{item.quantity}
                          </span>
                        )}
                        <span className="text-xs text-arda-text-muted">
                          {order.supplier}
                        </span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Additional Suppliers Section */}
      <div className="border-2 border-gray-200 rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-xl font-bold text-arda-text-primary">Other Suppliers</h3>
            <p className="text-sm text-arda-text-secondary">
              {isDiscovering 
                ? 'Discovering...' 
                : `${supplierCount} additional suppliers found`}
            </p>
          </div>
          
          {hasDiscovered && !isScanning && enabledCount > 0 && (
            <button
              onClick={handleScanSuppliers}
              className="bg-arda-accent hover:bg-blue-600 text-white px-5 py-2.5 rounded-xl font-medium transition-all flex items-center gap-2"
            >
              <Icons.Download className="w-4 h-4" />
              Import {enabledCount} Suppliers
            </button>
          )}
        </div>

        {/* Scanning Progress */}
        {isScanning && jobStatus && (
          <div className="mb-4 bg-blue-50 border border-blue-200 rounded-xl p-4">
            <div className="flex items-center gap-3 mb-2">
              <Icons.Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
              <span className="font-medium text-blue-700">
                {jobStatus.progress?.currentTask || 'Processing...'}
              </span>
            </div>
            <div className="h-2 bg-blue-100 rounded-full overflow-hidden">
              <div 
                className="h-full bg-blue-500 transition-all duration-300"
                style={{ 
                  width: `${(jobStatus.progress?.processed || 0) / Math.max(jobStatus.progress?.total || 1, 1) * 100}%` 
                }}
              />
            </div>
            
            {/* Other Orders Items */}
            {otherOrders.length > 0 && (
              <div className="mt-4 max-h-32 overflow-y-auto">
                <div className="grid grid-cols-2 gap-2">
                  {otherOrders.flatMap((order, orderIdx) => 
                    order.items.slice(0, 4).map((item, itemIdx) => (
                      <div 
                        key={`${orderIdx}-${itemIdx}`} 
                        className="bg-white rounded-lg px-3 py-2 text-sm flex items-center gap-2"
                      >
                        <Icons.Package className="w-4 h-4 text-green-500 flex-shrink-0" />
                        <span className="truncate text-arda-text-primary">{item.name}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Supplier Grid */}
        {!isScanning && hasDiscovered && supplierCount > 0 && (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
            {supplierGridItems.map(({ supplier, colors, isEnabled }) => (
              <div
                key={supplier.domain}
                onClick={() => handleToggleSupplier(supplier.domain)}
                className={`
                  relative aspect-square p-3 rounded-xl border-2 cursor-pointer transition-all
                  flex flex-col items-center justify-center text-center
                  ${isEnabled 
                    ? 'bg-white border-arda-accent shadow-md scale-105' 
                    : 'bg-gray-50 border-gray-200 hover:border-gray-300 opacity-60 hover:opacity-100'
                  }
                `}
              >
                {isEnabled && (
                  <div className="absolute top-2 right-2">
                    <Icons.CheckCircle2 className="w-5 h-5 text-arda-accent" />
                  </div>
                )}
                <div className="text-2xl mb-1">{colors.icon}</div>
                <div className="text-sm font-medium text-arda-text-primary truncate w-full">
                  {supplier.displayName}
                </div>
                {supplier.emailCount > 0 && (
                  <div className="text-xs text-arda-text-muted">
                    {supplier.emailCount} emails
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Discovering state */}
        {isDiscovering && (
          <div className="flex items-center justify-center py-8">
            <Icons.Loader2 className="w-6 h-6 text-blue-500 animate-spin mr-3" />
            <span className="text-arda-text-secondary">{discoveryProgress}</span>
          </div>
        )}
      </div>

      {/* Insights Preview Card - Tease value */}
      {allItems.length >= 10 && (
        <div className="bg-gradient-to-br from-purple-50 to-blue-50 border-2 border-purple-200 rounded-2xl p-6">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-purple-500 rounded-xl flex items-center justify-center flex-shrink-0">
              <Icons.BarChart3 className="w-6 h-6 text-white" />
            </div>
            <div className="flex-1">
              <h3 className="text-xl font-bold text-arda-text-primary mb-2">
                Insights Coming Soon...
              </h3>
              <p className="text-arda-text-secondary mb-4">
                Based on your {allItems.length} items, Arda will help you:
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="bg-white/70 rounded-lg p-3">
                  <div className="text-lg font-bold text-purple-600">🔄</div>
                  <div className="text-sm font-medium text-arda-text-primary">Auto-Reorder</div>
                  <div className="text-xs text-arda-text-muted">Set up Kanban cards</div>
                </div>
                <div className="bg-white/70 rounded-lg p-3">
                  <div className="text-lg font-bold text-blue-600">📈</div>
                  <div className="text-sm font-medium text-arda-text-primary">Track Velocity</div>
                  <div className="text-xs text-arda-text-muted">See consumption patterns</div>
                </div>
                <div className="bg-white/70 rounded-lg p-3">
                  <div className="text-lg font-bold text-green-600">💰</div>
                  <div className="text-sm font-medium text-arda-text-primary">Optimize Spend</div>
                  <div className="text-xs text-arda-text-muted">Find savings opportunities</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Floating Action Bar */}
      {(allItems.length > 0 || totalOrders > 0) && !isAnyProcessing && (
        <div className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-sm border-t border-gray-200 shadow-2xl p-4 z-40">
          <div className="max-w-5xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-6">
              <div>
                <div className="text-2xl font-bold text-arda-text-primary">{allItems.length} items</div>
                <div className="text-sm text-arda-text-muted">
                  from {totalOrders} orders across {uniqueSuppliers} suppliers
                </div>
              </div>
              {totalSpend > 0 && (
                <div className="hidden sm:block pl-6 border-l border-gray-200">
                  <div className="text-2xl font-bold text-green-600">
                    ${totalSpend.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <div className="text-sm text-arda-text-muted">total tracked</div>
                </div>
              )}
            </div>
            <button
              onClick={handleComplete}
              className="bg-gradient-to-r from-arda-accent to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white px-8 py-4 rounded-xl font-bold text-lg transition-all shadow-lg hover:shadow-xl flex items-center gap-3"
            >
              Set Up My Inventory
              <Icons.ArrowRight className="w-6 h-6" />
            </button>
          </div>
        </div>
      )}
      
      {/* Skip option for users who want to explore first */}
      {showWelcome && !isAnyProcessing && allItems.length === 0 && (
        <div className="text-center">
          <button
            onClick={onSkip}
            className="text-arda-text-muted hover:text-arda-text-secondary transition-colors text-sm"
          >
            Skip for now and explore the app →
          </button>
        </div>
      )}
    </div>
  );
};
