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

// Lean manufacturing wisdom - displayed while we ironically batch-process emails
const LEAN_WISDOM = [
  {
    quote: "The irony of batch-processing your emails to teach you about single-piece flow is not lost on us.",
    attribution: "— Arda Engineering, probably",
  },
  {
    quote: "Batch processing: Because nothing says 'efficiency' like making 49 emails wait for the 50th.",
    attribution: "— Every ERP System Ever",
  },
  {
    quote: "In the time it takes to batch 100 orders, you could have flowed 100 orders. But here we are.",
    attribution: "— Taiichi Ohno, if he saw this loading screen",
  },
  {
    quote: "A batch in process is inventory in disguise. Speaking of which, we're currently 'inventorying' your inbox.",
    attribution: "— The Toyota Production System",
  },
  {
    quote: "Single-piece flow means doing one thing at a time. We're doing all your emails at once. Do as we say, not as we code.",
    attribution: "— Software Engineering Proverb",
  },
  {
    quote: "The best time to stop batching was 20 years ago. The second best time is after this loading screen finishes.",
    attribution: "— Ancient Lean Proverb",
  },
  {
    quote: "Every email we batch-process right now is a little lesson in why you shouldn't batch-process.",
    attribution: "— The Arda Paradox",
  },
  {
    quote: "If Ohno saw this loading spinner, he'd probably suggest we process one email, deliver the insight, then get the next one.",
    attribution: "— Things We Know But Don't Do",
  },
  {
    quote: "WIP limits are great! We're currently ignoring ours. Don't be like us.",
    attribution: "— Kanban's Disappointed Dad Voice",
  },
  {
    quote: "Small batches reduce lead time. Anyway, here's 500 emails at once.",
    attribution: "— Arda's Growth Team",
  },
  {
    quote: "The goal of lean is to eliminate waste. This loading screen is technically waste. We're working on it.",
    attribution: "— Our Product Roadmap, Probably",
  },
  {
    quote: "Flow efficiency > resource efficiency. Unless you're an email parser. Then it's complicated.",
    attribution: "— DevOps Philosophy",
  },
  {
    quote: "Muda, Mura, Muri: Waste, Unevenness, Overburden. This scan has all three. Your shop floor shouldn't.",
    attribution: "— TPS for Hypocrites",
  },
  {
    quote: "The seven wastes include 'waiting.' You're welcome.",
    attribution: "— This Loading Screen",
  },
  {
    quote: "The seven wastes also include 'wasted human potential.' So. Yeah. There's a lot of other stuff we could be doing here.",
    attribution: "— This Loading Screen",
  },
  {
    quote: "One-piece flow would be: scan email → show insight → repeat. But our PM wanted a 'wow moment.' So here we batch.",
    attribution: "— Honest Engineering Notes",
  },
];

// Background progress type for parent components
interface BackgroundEmailProgress {
  isActive: boolean;
  supplier: string;
  processed: number;
  total: number;
  currentTask?: string;
}

// State that can be preserved when navigating away
export interface EmailScanState {
  amazonOrders: ExtractedOrder[];
  priorityOrders: ExtractedOrder[];
  otherOrders: ExtractedOrder[];
  isAmazonComplete: boolean;
  isPriorityComplete: boolean;
  discoveredSuppliers: DiscoveredSupplier[];
  hasDiscovered: boolean;
}

interface SupplierSetupProps {
  onScanComplete: (orders: ExtractedOrder[]) => void;
  onSkip: () => void;
  onProgressUpdate?: (progress: BackgroundEmailProgress | null) => void;
  onCanProceed?: (canProceed: boolean) => void;
  onStateChange?: (state: EmailScanState) => void;
  initialState?: EmailScanState;
}

export const SupplierSetup: React.FC<SupplierSetupProps> = ({
  onScanComplete,
  onSkip,
  onProgressUpdate,
  onCanProceed,
  onStateChange,
  initialState,
}) => {
  // Track if we already have restored state (don't restart scans)
  const hasRestoredState = Boolean(initialState && (initialState.amazonOrders.length > 0 || initialState.priorityOrders.length > 0 || initialState.otherOrders.length > 0));
  
  // Onboarding phase states
  const [showWelcome, setShowWelcome] = useState(!hasRestoredState);
  const [celebratingMilestone, setCelebratingMilestone] = useState<string | null>(null);
  const [achievedMilestones, setAchievedMilestones] = useState<Set<string>>(new Set());
  
  // Lean wisdom rotation
  const [wisdomIndex, setWisdomIndex] = useState(() => Math.floor(Math.random() * LEAN_WISDOM.length));
  
  // Discovery progress messages for better feedback
  const [discoveryMessageIndex, setDiscoveryMessageIndex] = useState(0);
  const DISCOVERY_MESSAGES = useMemo(() => [
    'Scanning your inbox for suppliers...',
    'Looking for order confirmations...',
    'Identifying supplier domains...',
    'Analyzing email patterns...',
    'Finding shipping notifications...',
    'Detecting invoice emails...',
  ], []);

  // Amazon processing state (starts immediately if no initial state)
  const [amazonJobId, setAmazonJobId] = useState<string | null>(null);
  const [amazonStatus, setAmazonStatus] = useState<JobStatus | null>(null);
  const [amazonOrders, setAmazonOrders] = useState<ExtractedOrder[]>(initialState?.amazonOrders || []);
  const [amazonError, setAmazonError] = useState<string | null>(null);
  const [isAmazonComplete, setIsAmazonComplete] = useState(initialState?.isAmazonComplete || false);
  const amazonPollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Priority suppliers (McMaster-Carr, Uline) processing state (starts immediately if no initial state)
  const [priorityJobId, setPriorityJobId] = useState<string | null>(null);
  const [priorityStatus, setPriorityStatus] = useState<JobStatus | null>(null);
  const [priorityOrders, setPriorityOrders] = useState<ExtractedOrder[]>(initialState?.priorityOrders || []);
  const [priorityError, setPriorityError] = useState<string | null>(null);
  const [isPriorityComplete, setIsPriorityComplete] = useState(initialState?.isPriorityComplete || false);
  const priorityPollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Discovery state (runs in parallel)
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [discoveryProgress, setDiscoveryProgress] = useState<string>('');
  const [discoveredSuppliers, setDiscoveredSuppliers] = useState<DiscoveredSupplier[]>(initialState?.discoveredSuppliers || []);
  const [enabledSuppliers, setEnabledSuppliers] = useState<Set<string>>(
    new Set(['mcmaster.com', 'uline.com'])
  );
  const [, setDiscoverError] = useState<string | null>(null);
  const [hasDiscovered, setHasDiscovered] = useState(initialState?.hasDiscovered || false);

  // Other suppliers scanning state
  const [isScanning, setIsScanning] = useState(false);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [otherOrders, setOtherOrders] = useState<ExtractedOrder[]>(initialState?.otherOrders || []);
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

  // Rotate lean wisdom (every 10 seconds, always running)
  useEffect(() => {
    const interval = setInterval(() => {
      setWisdomIndex(prev => (prev + 1) % LEAN_WISDOM.length);
    }, 10000);
    
    return () => clearInterval(interval);
  }, [hasRestoredState]);
  
  // Rotate discovery messages while scanning (every 2.5 seconds)
  useEffect(() => {
    if (!isDiscovering) return;
    
    const interval = setInterval(() => {
      setDiscoveryMessageIndex(prev => (prev + 1) % DISCOVERY_MESSAGES.length);
    }, 2500);
    
    return () => clearInterval(interval);
  }, [isDiscovering, DISCOVERY_MESSAGES.length]);

  // 1. START PRIORITY SUPPLIERS - STAGGERED TO AVOID RATE LIMITS
  // Skip if we have restored state (user navigated back)
  useEffect(() => {
    // Skip initialization if we restored from saved state
    if (hasRestoredState) {
      console.log('📦 Restored email scan state - skipping initialization');
      return;
    }
    
    let amazonRetryTimeout: ReturnType<typeof setTimeout> | null = null;
    let priorityDelayTimeout: ReturnType<typeof setTimeout> | null = null;
    
    // Start Amazon with retry logic
    const startAmazon = async (retryCount = 0) => {
      try {
        console.log(`🛒 Starting Amazon processing${retryCount > 0 ? ` (retry ${retryCount})` : ''}...`);
        const response = await jobsApi.startAmazon();
        setAmazonJobId(response.jobId);
        setAmazonError(null);
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to start Amazon processing';
        console.error('Amazon processing error:', errorMessage);
        
        // Retry on rate limit or temporary errors (up to 3 times)
        if (retryCount < 3 && (errorMessage.includes('rate') || errorMessage.includes('429') || errorMessage.includes('Too many'))) {
          const retryDelay = (retryCount + 1) * 3000; // 3s, 6s, 9s
          console.log(`⏳ Rate limited, retrying Amazon in ${retryDelay / 1000}s...`);
          amazonRetryTimeout = setTimeout(() => startAmazon(retryCount + 1), retryDelay);
        } else {
          setAmazonError(errorMessage);
        }
      }
    };
    
    // Start McMaster-Carr and Uline (delayed to avoid rate limits)
    const startPrioritySuppliers = async (retryCount = 0) => {
      try {
        console.log(`🏭 Starting McMaster-Carr & Uline${retryCount > 0 ? ` (retry ${retryCount})` : ''}...`);
        const response = await jobsApi.startJob(['mcmaster.com', 'uline.com'], 'priority');
        setPriorityJobId(response.jobId);
        setPriorityError(null);
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to start McMaster-Carr & Uline';
        console.error('Priority suppliers error:', errorMessage);
        
        // Retry on rate limit (up to 3 times)
        if (retryCount < 3 && (errorMessage.includes('rate') || errorMessage.includes('429') || errorMessage.includes('Too many'))) {
          const retryDelay = (retryCount + 1) * 4000; // 4s, 8s, 12s
          console.log(`⏳ Rate limited, retrying priority suppliers in ${retryDelay / 1000}s...`);
          setTimeout(() => startPrioritySuppliers(retryCount + 1), retryDelay);
        } else {
          setPriorityError(errorMessage);
        }
      }
    };
    
    // Start Amazon immediately
    startAmazon();
    
    // Delay priority suppliers by 2 seconds to stagger API calls
    priorityDelayTimeout = setTimeout(() => {
      startPrioritySuppliers();
    }, 2000);
    
    // Cleanup on unmount
    return () => {
      if (amazonRetryTimeout) clearTimeout(amazonRetryTimeout);
      if (priorityDelayTimeout) clearTimeout(priorityDelayTimeout);
    };
  }, [hasRestoredState]);

  // 2. START SUPPLIER DISCOVERY (delayed to stagger API calls)
  useEffect(() => {
    if (!hasDiscovered && !isDiscovering) {
      // Delay discovery by 4 seconds to avoid overwhelming the server
      const discoveryTimeout = setTimeout(() => {
        handleDiscoverSuppliers();
      }, 4000);
      
      return () => clearTimeout(discoveryTimeout);
    }
  }, [hasDiscovered, isDiscovering]);

  // Poll Amazon job status
  const pollAmazonStatus = useCallback(async () => {
    if (!amazonJobId) return;
    
    try {
      const status = await jobsApi.getStatus(amazonJobId);
      console.log(`🛒 Amazon poll: ${status.progress?.processed}/${status.progress?.total}, status=${status.status}`);
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
      console.log('🛒 Starting Amazon polling interval');
      pollAmazonStatus();
      amazonPollingRef.current = setInterval(pollAmazonStatus, 1000);
      return () => {
        console.log('🛒 Clearing Amazon polling interval');
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

  // Notify parent when Amazon + Priority suppliers are done (user can proceed)
  useEffect(() => {
    const keySuppliersDone = isAmazonComplete && isPriorityComplete;
    onCanProceed?.(keySuppliersDone);
  }, [isAmazonComplete, isPriorityComplete, onCanProceed]);

  // Preserve state for parent (so navigation back doesn't lose progress)
  useEffect(() => {
    onStateChange?.({
      amazonOrders,
      priorityOrders,
      otherOrders,
      isAmazonComplete,
      isPriorityComplete,
      discoveredSuppliers,
      hasDiscovered,
    });
  }, [amazonOrders, priorityOrders, otherOrders, isAmazonComplete, isPriorityComplete, discoveredSuppliers, hasDiscovered, onStateChange]);

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
    } catch (err: unknown) {
      console.error('Discovery error:', err);
      const message = err instanceof Error ? err.message : 'Failed to discover suppliers';
      setDiscoverError(message);
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
      const response = await jobsApi.startJob(domainsToScan, 'other');
      setCurrentJobId(response.jobId);
    } catch (error) {
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

  // Keep parent updated with collected orders as they come in
  useEffect(() => {
    if (combinedOrders.length > 0) {
      onScanComplete(combinedOrders);
    }
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
  // Report progress to parent component for background display
  useEffect(() => {
    if (!onProgressUpdate) return;
    
    // Determine active scanning progress
    if (isScanning && jobStatus?.progress) {
      onProgressUpdate({
        isActive: true,
        supplier: 'Other Suppliers',
        processed: jobStatus.progress.processed || 0,
        total: jobStatus.progress.total || 0,
        currentTask: jobStatus.progress.currentTask,
      });
    } else if (isPriorityProcessing && priorityStatus?.progress) {
      onProgressUpdate({
        isActive: true,
        supplier: 'McMaster-Carr & Uline',
        processed: priorityStatus.progress.processed || 0,
        total: priorityStatus.progress.total || 0,
        currentTask: priorityStatus.progress.currentTask,
      });
    } else if (!isAmazonComplete && amazonStatus?.progress) {
      onProgressUpdate({
        isActive: true,
        supplier: 'Amazon',
        processed: amazonStatus.progress.processed || 0,
        total: amazonStatus.progress.total || 0,
        currentTask: amazonStatus.progress.currentTask,
      });
    } else if (!isAnyProcessing) {
      onProgressUpdate(null);
    }
  }, [
    onProgressUpdate, 
    isScanning, 
    jobStatus, 
    isPriorityProcessing, 
    priorityStatus, 
    isAmazonComplete, 
    amazonStatus, 
    isAnyProcessing
  ]);

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


      {/* Lean Wisdom - Always visible */}
      <div>
        <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-xl p-5">
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0 w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center">
              <Icons.Lightbulb className="w-5 h-5 text-amber-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-amber-900 mb-1">
                {isAnyProcessing ? 'While you wait, a word about batching...' : 'A word about batching...'}
              </p>
              <blockquote className="text-amber-800 italic text-sm leading-relaxed">
                "{LEAN_WISDOM[wisdomIndex].quote}"
              </blockquote>
              <p className="text-xs text-amber-600 mt-2 font-medium">
                {LEAN_WISDOM[wisdomIndex].attribution}
              </p>
            </div>
          </div>
        </div>
      </div>

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
          <button
            type="button"
            onClick={onSkip}
            className="text-sm font-semibold text-arda-accent hover:text-arda-accent/80 transition-colors"
          >
            Skip for now
          </button>
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
              className="bg-arda-accent hover:bg-arda-accent-hover text-white px-5 py-2.5 rounded-xl font-medium transition-all flex items-center gap-2"
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

        {/* Discovering state - Enhanced feedback */}
        {isDiscovering && (
          <div className="py-6 space-y-6">
            {/* Animated progress message */}
            <div className="flex items-center justify-center gap-3">
              <div className="relative">
                <Icons.Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
                <div className="absolute inset-0 animate-ping opacity-30">
                  <Icons.Loader2 className="w-6 h-6 text-blue-500" />
                </div>
              </div>
              <span className="text-arda-text-secondary font-medium transition-opacity duration-300">
                {DISCOVERY_MESSAGES[discoveryMessageIndex]}
              </span>
            </div>
            
            {/* Scanning animation - shows activity */}
            <div className="bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-100 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <Icons.Search className="w-4 h-4 text-blue-500 animate-pulse" />
                <span className="text-sm font-medium text-blue-700">
                  {DISCOVERY_MESSAGES[discoveryMessageIndex]}
                </span>
              </div>
              
              {/* Animated scanning bars */}
              <div className="space-y-2">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div 
                      className="h-2 rounded-full animate-shimmer"
                      style={{ 
                        width: `${65 + i * 8}%`,
                        animationDelay: `${i * 150}ms`,
                      }}
                    />
                    <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" style={{ animationDelay: `${i * 200}ms` }} />
                  </div>
                ))}
              </div>
            </div>
            
            {/* Skeleton placeholder grid for suppliers being discovered */}
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div
                  key={i}
                  className="aspect-square p-3 rounded-xl border-2 border-gray-100 bg-gray-50 flex flex-col items-center justify-center animate-pulse"
                  style={{ animationDelay: `${i * 100}ms` }}
                >
                  <div className="w-8 h-8 rounded-lg bg-gray-200 mb-2" />
                  <div className="w-16 h-3 rounded bg-gray-200" />
                </div>
              ))}
            </div>
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

      {/* Note: Navigation handled by OnboardingFlow footer */}
    </div>
  );
};
