import { useState, useEffect, useMemo, useRef } from 'react';
import { Icons } from '../components/Icons';
import { ExtractedOrder } from '../types';
import { discoverApi, jobsApi, JobStatus, DiscoveredSupplier } from '../services/api';
import { mergeSuppliers } from '../utils/supplierUtils';

interface SupplierSetupProps {
  onScanComplete: (orders: ExtractedOrder[]) => void;
  onSkip: () => void;
}

// Non-Amazon priority suppliers
const OTHER_PRIORITY_SUPPLIERS: DiscoveredSupplier[] = [
  {
    domain: 'mcmaster.com',
    displayName: 'McMaster-Carr',
    emailCount: 0,
    score: 100,
    category: 'industrial',
    sampleSubjects: [],
    isRecommended: true,
  },
  {
    domain: 'uline.com',
    displayName: 'Uline',
    emailCount: 0,
    score: 100,
    category: 'industrial',
    sampleSubjects: [],
    isRecommended: true,
  },
];

const CATEGORY_COLORS: Record<string, { bg: string; text: string; icon: string }> = {
  industrial: { bg: 'bg-blue-50', text: 'text-blue-600', icon: '🏭' },
  retail: { bg: 'bg-green-50', text: 'text-green-600', icon: '🛒' },
  electronics: { bg: 'bg-cyan-50', text: 'text-cyan-600', icon: '⚡' },
  office: { bg: 'bg-purple-50', text: 'text-purple-600', icon: '📎' },
  food: { bg: 'bg-orange-50', text: 'text-orange-600', icon: '🍽️' },
  unknown: { bg: 'bg-gray-50', text: 'text-gray-600', icon: '📦' },
};

export const SupplierSetup: React.FC<SupplierSetupProps> = ({
  onScanComplete,
  onSkip,
}) => {
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

  // Merge priority suppliers with discovered ones (excluding Amazon)
const allSuppliers = useMemo(() => mergeSuppliers(OTHER_PRIORITY_SUPPLIERS, discoveredSuppliers), [discoveredSuppliers]);

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
      console.error('Polling error:', error);
    }
  }, [currentJobId]);

  useEffect(() => {
    if (isScanning && currentJobId) {
      pollJobStatus();
      pollingRef.current = setInterval(pollJobStatus, 1000);
      return () => {
        if (pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
      };
    }
  }, [isScanning, currentJobId, pollJobStatus]);

  const handleDiscoverSuppliers = async () => {
    setIsDiscovering(true);
    setDiscoverError(null);
    setDiscoveryProgress('Connecting to Gmail...');
    
    try {
      setDiscoveryProgress('Scanning email headers...');
      const response = await discoverApi.discoverSuppliers();
      
      setDiscoveryProgress(`Found ${response.suppliers.length} potential suppliers`);
      setDiscoveredSuppliers(response.suppliers);
      
      const newEnabled = new Set(enabledSuppliers);
      response.suppliers
        .filter(s => s.isRecommended && !s.domain.includes('amazon'))
        .forEach(s => newEnabled.add(s.domain));
      setEnabledSuppliers(newEnabled);
      
      setHasDiscovered(true);
    } catch (error: any) {
      console.error('Failed to discover suppliers:', error);
      setDiscoverError(error.message || 'Failed to discover suppliers');
    } finally {
      setIsDiscovering(false);
      setDiscoveryProgress('');
    }
  };

  const handleToggleSupplier = (domain: string) => {
    setEnabledSuppliers(prev => {
      const next = new Set(prev);
      if (next.has(domain)) {
        next.delete(domain);
      } else {
        next.add(domain);
      }
      return next;
    });
  };

  const handleStartScan = async () => {
    const suppliersToScan = Array.from(enabledSuppliers);
    if (suppliersToScan.length === 0) {
      alert('Please select at least one supplier to scan.');
      return;
    }

    setIsScanning(true);
    setOtherOrders([]);
    setJobStatus(null);
    
    try {
      console.log('Starting scan for suppliers:', suppliersToScan);
      const response = await jobsApi.startJob(suppliersToScan);
      setCurrentJobId(response.jobId);
    } catch (error: any) {
      console.error('Failed to start scan:', error);
      setDiscoverError(error.message || 'Failed to start scan. Please try again.');
      setIsScanning(false);
    }
  };

  const handleComplete = () => {
    const allOrders = [...amazonOrders, ...priorityOrders, ...otherOrders];
    onScanComplete(allOrders);
  };

  const suppliers = allSuppliers;
  const enabledCount = enabledSuppliers.size;
  const totalOrders = amazonOrders.length + priorityOrders.length + otherOrders.length;
  const isPriorityProcessing = (!isPriorityComplete && priorityJobId);
  const isAnyProcessing = (!isAmazonComplete && amazonJobId) || isPriorityProcessing || isScanning;
  
  // Priority suppliers progress
  const priorityProgress = priorityStatus?.progress;
  const priorityProgressPercent = priorityProgress 
    ? (priorityProgress.processed / Math.max(priorityProgress.total, 1)) * 100 
    : 0;

  const amazonProgress = amazonStatus?.progress;
  const amazonProgressPercent = amazonProgress 
    ? (amazonProgress.processed / amazonProgress.total) * 100 
    : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-arda-text-primary">Import Orders</h1>
          <p className="text-arda-text-secondary mt-1">
            {isAnyProcessing 
              ? 'Processing Amazon, McMaster-Carr, and Uline automatically...'
              : 'Priority suppliers processed. Select additional suppliers below.'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {!isAnyProcessing && totalOrders > 0 && (
            <button
              onClick={handleComplete}
              className="bg-arda-success hover:bg-green-600 text-white px-5 py-2 rounded-lg font-medium transition-colors"
            >
              Continue with {totalOrders} orders →
            </button>
          )}
          {!isAnyProcessing && (
            <button
              onClick={onSkip}
              className="text-sm text-arda-text-muted hover:text-arda-text-primary transition-colors"
            >
              Skip
            </button>
          )}
        </div>
      </div>

      {/* Amazon Processing Card */}
      <div className={`border rounded-xl p-5 ${
        amazonError
          ? 'bg-red-50 border-red-200'
          : isAmazonComplete 
            ? amazonOrders.length > 0 
              ? 'bg-green-50 border-green-200' 
              : 'bg-gray-50 border-gray-200'
            : 'bg-orange-50 border-orange-200'
      }`}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            {amazonError ? (
              <Icons.AlertCircle className="w-5 h-5 text-red-500" />
            ) : !isAmazonComplete ? (
              <Icons.Loader2 className="w-5 h-5 text-orange-500 animate-spin" />
            ) : amazonOrders.length > 0 ? (
              <Icons.CheckCircle2 className="w-5 h-5 text-green-500" />
            ) : (
              <Icons.AlertCircle className="w-5 h-5 text-gray-400" />
            )}
            <div>
              <span className="text-lg font-semibold text-arda-text-primary">🛒 Amazon</span>
              <span className={`ml-2 text-sm ${
                amazonError ? 'text-red-600' : 'text-arda-text-secondary'
              }`}>
                {amazonError 
                  ? amazonError
                  : !isAmazonComplete 
                    ? 'Processing with ASIN enrichment...'
                    : amazonOrders.length > 0 
                      ? `${amazonOrders.length} orders imported`
                      : 'No Amazon orders found'
                }
              </span>
            </div>
          </div>
          
          {amazonProgress && !isAmazonComplete && !amazonError && (
            <span className="text-arda-text-muted text-sm font-mono">
              {amazonProgress.processed} / {amazonProgress.total}
            </span>
          )}
          
          {amazonError && (
            <button
              onClick={() => {
                setAmazonError(null);
                setIsAmazonComplete(false);
                jobsApi.startAmazon()
                  .then(response => setAmazonJobId(response.jobId))
                  .catch(err => setAmazonError(err.message));
              }}
              className="text-sm bg-red-100 hover:bg-red-200 text-red-700 px-3 py-1.5 rounded transition-colors"
            >
              Retry
            </button>
          )}
        </div>

        {/* Amazon Progress Bar */}
        {!isAmazonComplete && amazonProgress && !amazonError && (
          <div className="mb-3">
            <div className="h-2 bg-orange-100 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-orange-500 to-yellow-400 transition-all duration-300"
                style={{ width: `${amazonProgressPercent}%` }}
              />
            </div>
            <div className="text-xs text-arda-text-muted mt-1">
              {amazonProgress.currentTask}
            </div>
          </div>
        )}

        {/* Amazon Activity Logs */}
        {amazonStatus?.logs && amazonStatus.logs.length > 0 && !isAmazonComplete && (
          <div className="max-h-32 overflow-y-auto mb-3">
            <div className="space-y-0.5 font-mono text-xs">
              {amazonStatus.logs.slice(-8).reverse().map((log, i) => (
                <div 
                  key={i} 
                  className={`py-0.5 ${
                    log.includes('🛍️') ? 'text-green-600' : 
                    log.includes('📦') ? 'text-orange-600' :
                    log.includes('✅') ? 'text-green-600' :
                    log.includes('⚠️') ? 'text-yellow-600' :
                    'text-arda-text-muted'
                  }`}
                >
                  {log}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Amazon Live Results - Show items with images */}
        {amazonOrders.length > 0 && amazonOrders[0]?.items?.length > 0 && (
          <div className="border-t border-orange-200 pt-3 mt-3">
            <div className="text-xs text-arda-text-muted mb-2">Products found:</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {amazonOrders[0].items.slice(0, 8).map((item, i) => (
                <div key={i} className="bg-white border border-green-200 rounded-lg p-2 flex items-center gap-2">
                  {item.amazonEnriched?.imageUrl && (
                    <img 
                      src={item.amazonEnriched.imageUrl} 
                      alt="" 
                      className="w-10 h-10 object-contain flex-shrink-0"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-arda-text-primary truncate">
                      {item.amazonEnriched?.itemName || item.name}
                    </div>
                    {(item.unitPrice ?? 0) > 0 && (
                      <div className="text-xs text-green-600 font-medium">
                        ${(item.unitPrice ?? 0).toFixed(2)}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {amazonOrders[0].items.length > 8 && (
              <div className="text-xs text-arda-text-muted mt-2">
                + {amazonOrders[0].items.length - 8} more items
              </div>
            )}
          </div>
        )}
      </div>

      {/* McMaster-Carr & Uline Processing Card */}
      <div className={`border rounded-xl p-5 ${
        priorityError
          ? 'bg-red-50 border-red-200'
          : isPriorityComplete 
            ? priorityOrders.length > 0 
              ? 'bg-green-50 border-green-200' 
              : 'bg-gray-50 border-gray-200'
            : 'bg-blue-50 border-blue-200'
      }`}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            {priorityError ? (
              <Icons.AlertCircle className="w-5 h-5 text-red-500" />
            ) : !isPriorityComplete ? (
              <Icons.Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
            ) : priorityOrders.length > 0 ? (
              <Icons.CheckCircle2 className="w-5 h-5 text-green-500" />
            ) : (
              <Icons.AlertCircle className="w-5 h-5 text-gray-400" />
            )}
            <div>
              <span className="text-lg font-semibold text-arda-text-primary">🏭 McMaster-Carr & Uline</span>
              <span className={`ml-2 text-sm ${
                priorityError ? 'text-red-600' : 'text-arda-text-secondary'
              }`}>
                {priorityError 
                  ? priorityError
                  : !isPriorityComplete 
                    ? 'Analyzing order emails...'
                    : priorityOrders.length > 0 
                      ? `${priorityOrders.reduce((sum, o) => sum + o.items.length, 0)} items from ${priorityOrders.length} orders`
                      : 'No orders found'
                }
              </span>
            </div>
          </div>
          
          {priorityProgress && !isPriorityComplete && !priorityError && (
            <span className="text-arda-text-muted text-sm font-mono">
              {priorityProgress.processed} / {priorityProgress.total}
            </span>
          )}
          
          {priorityError && (
            <button
              onClick={() => {
                setPriorityError(null);
                setIsPriorityComplete(false);
                jobsApi.startJob(['mcmaster.com', 'uline.com'])
                  .then(response => setPriorityJobId(response.jobId))
                  .catch(err => setPriorityError(err.message));
              }}
              className="text-sm bg-red-100 hover:bg-red-200 text-red-700 px-3 py-1.5 rounded transition-colors"
            >
              Retry
            </button>
          )}
        </div>

        {/* Priority Progress Bar */}
        {!isPriorityComplete && priorityProgress && !priorityError && (
          <div className="mb-3">
            <div className="h-2 bg-blue-100 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-blue-500 to-blue-400 transition-all duration-300"
                style={{ width: `${priorityProgressPercent}%` }}
              />
            </div>
            <div className="text-xs text-arda-text-muted mt-1">
              {priorityProgress.currentTask}
            </div>
          </div>
        )}

        {/* Priority Activity Logs */}
        {priorityStatus?.logs && priorityStatus.logs.length > 0 && !isPriorityComplete && (
          <div className="max-h-32 overflow-y-auto mb-3">
            <div className="space-y-0.5 font-mono text-xs">
              {priorityStatus.logs.slice(-8).reverse().map((log, i) => (
                <div 
                  key={i} 
                  className={`py-0.5 ${
                    log.includes('📦') ? 'text-green-600 pl-4' : 
                    log.includes('🏢') ? 'text-blue-600 font-medium' :
                    log.includes('✓') ? 'text-green-600' :
                    log.includes('⚠️') ? 'text-yellow-600' :
                    'text-arda-text-muted'
                  }`}
                >
                  {log}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Priority Orders Results */}
        {priorityOrders.length > 0 && (
          <div className="border-t border-blue-200 pt-3 mt-3">
            <div className="text-xs text-arda-text-muted mb-2">Orders found:</div>
            <div className="flex flex-wrap gap-2">
              {priorityOrders.slice(0, 6).map((order, i) => (
                <div key={order.id || i} className="text-xs bg-white border border-green-200 text-arda-text-secondary px-2 py-1 rounded">
                  {order.supplier} • {order.items.length} items
                </div>
              ))}
              {priorityOrders.length > 6 && (
                <div className="text-xs text-arda-text-muted">
                  + {priorityOrders.length - 6} more orders
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Discovery Error */}
      {discoverError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <Icons.AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="text-red-700 font-medium">Supplier Discovery Error</div>
              <div className="text-red-600 text-sm mt-1">{discoverError}</div>
              <button
                onClick={() => {
                  setDiscoverError(null);
                  handleDiscoverSuppliers();
                }}
                className="mt-3 text-sm bg-red-100 hover:bg-red-200 text-red-700 px-3 py-1.5 rounded transition-colors"
              >
                Try Again
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Additional Suppliers Section */}
      <div className="border-t border-arda-border pt-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-arda-text-primary">Additional Suppliers</h2>
          {isDiscovering && (
            <div className="flex items-center gap-2 text-sm text-arda-text-muted">
              <Icons.Loader2 className="w-4 h-4 animate-spin" />
              {discoveryProgress}
            </div>
          )}
        </div>

        {/* Scanning Progress for Other Suppliers */}
        {isScanning && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 mb-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <Icons.Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
                <span className="text-arda-text-primary font-medium">Importing from {enabledCount} suppliers</span>
              </div>
              {jobStatus?.progress && (
                <span className="text-arda-text-muted text-sm font-mono">
                  {jobStatus.progress.processed} / {jobStatus.progress.total}
                </span>
              )}
            </div>

            {jobStatus?.progress && (
              <>
                <div className="h-2 bg-blue-100 rounded-full overflow-hidden mb-3">
                  <div 
                    className="h-full bg-gradient-to-r from-blue-500 to-blue-400 transition-all duration-300"
                    style={{ 
                      width: `${(jobStatus.progress.processed / jobStatus.progress.total) * 100}%` 
                    }}
                  />
                </div>
                
                <div className="flex justify-between text-sm">
                  <span className="text-green-600">
                    ✓ {jobStatus.progress.success} orders found
                  </span>
                  <span className="text-arda-text-muted text-xs">
                    {jobStatus.progress.currentTask}
                  </span>
                </div>
              </>
            )}

            {/* Show live logs with items being found */}
            {jobStatus?.logs && jobStatus.logs.length > 0 && (
              <div className="border-t border-blue-200 mt-4 pt-4 max-h-48 overflow-y-auto">
                <div className="text-xs text-arda-text-muted mb-2">Activity:</div>
                <div className="space-y-1 font-mono text-xs">
                  {jobStatus.logs.slice(-15).reverse().map((log, i) => (
                    <div 
                      key={i} 
                      className={`py-0.5 ${
                        log.includes('📦') ? 'text-green-600 pl-4' : 
                        log.includes('🏢') ? 'text-blue-600 font-medium' :
                        log.includes('✓') ? 'text-green-600' :
                        log.includes('⚠️') ? 'text-yellow-600' :
                        log.includes('❌') ? 'text-red-600' :
                        'text-arda-text-muted'
                      }`}
                    >
                      {log}
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {otherOrders.length > 0 && (
              <div className="border-t border-blue-200 mt-4 pt-4">
                <div className="text-xs text-arda-text-muted mb-2">Orders found:</div>
                <div className="flex flex-wrap gap-2">
                  {otherOrders.slice(-6).reverse().map((order, i) => (
                    <div key={order.id || i} className="text-xs bg-white border border-green-200 text-arda-text-secondary px-2 py-1 rounded">
                      {order.supplier} • {order.items.length} items
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Supplier Grid */}
        {!isScanning && (
          <>
            {isDiscovering && !hasDiscovered ? (
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-8 text-center">
                <Icons.Loader2 className="w-8 h-8 text-blue-500 animate-spin mx-auto mb-3" />
                <div className="text-arda-text-primary font-medium">{discoveryProgress}</div>
                <div className="text-arda-text-muted text-sm mt-1">Discovering other suppliers...</div>
              </div>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
                {suppliers.map((supplier) => {
                  const isEnabled = enabledSuppliers.has(supplier.domain);
                  const isPriority = OTHER_PRIORITY_SUPPLIERS.some(p => p.domain === supplier.domain);
                  const colors = CATEGORY_COLORS[supplier.category] || CATEGORY_COLORS.unknown;
                  
                  return (
                    <div
                      key={supplier.domain}
                      onClick={() => handleToggleSupplier(supplier.domain)}
                      className={`
                        relative aspect-square p-3 rounded-xl border-2 cursor-pointer transition-all
                        flex flex-col items-center justify-center text-center
                        ${isEnabled 
                          ? 'bg-white border-arda-accent shadow-md' 
                          : 'bg-gray-50 border-gray-200 hover:border-gray-300 opacity-60 hover:opacity-100'
                        }
                      `}
                    >
                      {isPriority && (
                        <div className="absolute top-1 right-1 w-2 h-2 bg-arda-accent rounded-full" />
                      )}

                      {isEnabled && (
                        <div className="absolute top-1.5 left-1.5">
                          <Icons.CheckCircle2 className="w-4 h-4 text-arda-accent" />
                        </div>
                      )}

                      <div className={`text-2xl mb-1 ${isEnabled ? '' : 'grayscale'}`}>
                        {colors.icon}
                      </div>

                      <div className={`text-xs font-medium truncate w-full ${
                        isEnabled ? 'text-arda-text-primary' : 'text-arda-text-muted'
                      }`}>
                        {supplier.displayName}
                      </div>

                      {supplier.emailCount > 0 && (
                        <div className="text-[10px] text-arda-text-muted mt-0.5">
                          {supplier.emailCount} emails
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Action Bar */}
            {!isDiscovering && (
              <div className="flex items-center justify-between pt-4 mt-4 border-t border-arda-border">
                <div className="flex items-center gap-4">
                  <span className="text-sm text-arda-text-muted">
                    {enabledCount} selected
                  </span>
                  {hasDiscovered && (
                    <button
                      onClick={handleDiscoverSuppliers}
                      className="text-sm text-arda-text-muted hover:text-arda-text-primary transition-colors flex items-center gap-1"
                    >
                      <Icons.RefreshCw className="w-3 h-3" />
                      Refresh
                    </button>
                  )}
                </div>
                <button
                  onClick={handleStartScan}
                  disabled={enabledCount === 0 || isScanning}
                  className="px-6 py-2.5 bg-arda-accent hover:bg-arda-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors flex items-center gap-2"
                >
                  <Icons.Download className="w-4 h-4" />
                  Import from {enabledCount} Suppliers
                </button>
              </div>
            )}
          </>
        )}

        {/* Other Suppliers Complete */}
        {!isScanning && jobStatus?.status === 'completed' && otherOrders.length > 0 && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-5 mt-4">
            <div className="flex items-center gap-3">
              <Icons.CheckCircle2 className="w-6 h-6 text-green-500" />
              <div>
                <div className="text-green-700 font-medium">Import Complete</div>
                <div className="text-green-600 text-sm">
                  {otherOrders.length} additional orders imported
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Summary Bar at Bottom */}
      {(amazonOrders.length > 0 || priorityOrders.length > 0 || otherOrders.length > 0) && !isAnyProcessing && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-arda-border shadow-lg p-4">
          <div className="max-w-5xl mx-auto flex items-center justify-between">
            <div className="text-arda-text-primary">
              <span className="font-semibold">{totalOrders} orders</span>
              <span className="text-arda-text-muted ml-2">
                ({amazonOrders.length} Amazon, {priorityOrders.length} McMaster/Uline, {otherOrders.length} other)
              </span>
            </div>
            <button
              onClick={handleComplete}
              className="bg-arda-success hover:bg-green-600 text-white px-6 py-2.5 rounded-lg font-medium transition-colors"
            >
              Continue to Dashboard →
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default SupplierSetup;
