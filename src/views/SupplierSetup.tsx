import { useState, useEffect, useCallback, useRef } from 'react';
import { Icons } from '../components/Icons';
import { ExtractedOrder } from '../types';
import { discoverApi, jobsApi, JobStatus, DiscoveredSupplier } from '../services/api';

interface SupplierSetupProps {
  onScanComplete: (orders: ExtractedOrder[]) => void;
  onSkip: () => void;
}

// Priority suppliers that should always be shown first
const PRIORITY_SUPPLIERS: DiscoveredSupplier[] = [
  {
    domain: 'amazon.com',
    displayName: 'Amazon',
    emailCount: 0,
    score: 100,
    category: 'retail',
    sampleSubjects: [],
    isRecommended: true,
  },
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
  industrial: { bg: 'bg-blue-500/20', text: 'text-blue-400', icon: '🏭' },
  retail: { bg: 'bg-green-500/20', text: 'text-green-400', icon: '🛒' },
  electronics: { bg: 'bg-cyan-500/20', text: 'text-cyan-400', icon: '⚡' },
  office: { bg: 'bg-purple-500/20', text: 'text-purple-400', icon: '📎' },
  food: { bg: 'bg-orange-500/20', text: 'text-orange-400', icon: '🍽️' },
  unknown: { bg: 'bg-slate-500/20', text: 'text-slate-400', icon: '📦' },
};

export const SupplierSetup: React.FC<SupplierSetupProps> = ({
  onScanComplete,
  onSkip,
}) => {
  // Discovery state
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [discoveryProgress, setDiscoveryProgress] = useState<string>('');
  const [discoveredSuppliers, setDiscoveredSuppliers] = useState<DiscoveredSupplier[]>([]);
  const [enabledSuppliers, setEnabledSuppliers] = useState<Set<string>>(
    new Set(['amazon.com', 'mcmaster.com', 'uline.com'])
  );
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [hasDiscovered, setHasDiscovered] = useState(false);

  // Scanning state
  const [isScanning, setIsScanning] = useState(false);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [extractedOrders, setExtractedOrders] = useState<ExtractedOrder[]>([]);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Merge priority suppliers with discovered ones
  const allSuppliers = useCallback(() => {
    const merged = new Map<string, DiscoveredSupplier>();
    
    // Add priority suppliers first
    PRIORITY_SUPPLIERS.forEach(s => merged.set(s.domain, { ...s }));
    
    // Merge discovered suppliers (update counts if priority, add if new)
    discoveredSuppliers.forEach(s => {
      if (merged.has(s.domain)) {
        const existing = merged.get(s.domain)!;
        merged.set(s.domain, {
          ...existing,
          emailCount: s.emailCount,
          sampleSubjects: s.sampleSubjects,
        });
      } else {
        merged.set(s.domain, s);
      }
    });
    
    // Sort: priority first, then by score
    return Array.from(merged.values()).sort((a, b) => {
      const aPriority = PRIORITY_SUPPLIERS.some(p => p.domain === a.domain);
      const bPriority = PRIORITY_SUPPLIERS.some(p => p.domain === b.domain);
      if (aPriority && !bPriority) return -1;
      if (!aPriority && bPriority) return 1;
      return b.score - a.score;
    });
  }, [discoveredSuppliers]);

  // Auto-start discovery on mount
  useEffect(() => {
    if (!hasDiscovered && !isDiscovering) {
      handleDiscoverSuppliers();
    }
  }, []);

  // Poll for job status during scanning
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
        setExtractedOrders(convertedOrders);
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

  // Start polling when scanning
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
      
      // Auto-enable all recommended suppliers
      const newEnabled = new Set(enabledSuppliers);
      response.suppliers.filter(s => s.isRecommended).forEach(s => newEnabled.add(s.domain));
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
    setExtractedOrders([]);
    setJobStatus(null);
    
    try {
      // Start the job with the selected supplier domains
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
    onScanComplete(extractedOrders);
  };

  // Group extracted orders by supplier
  const ordersBySupplier = extractedOrders.reduce((acc, order) => {
    const key = order.supplier;
    if (!acc[key]) acc[key] = [];
    acc[key].push(order);
    return acc;
  }, {} as Record<string, ExtractedOrder[]>);

  const suppliers = allSuppliers();
  const enabledCount = enabledSuppliers.size;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Supplier Discovery</h1>
          <p className="text-slate-400 mt-1">
            {isDiscovering 
              ? discoveryProgress || 'Scanning your inbox...'
              : hasDiscovered 
                ? `Found ${suppliers.length} suppliers • ${enabledCount} selected`
                : 'Select suppliers to import orders from'
            }
          </p>
        </div>
        <div className="flex items-center gap-3">
          {!isScanning && (
            <button
              onClick={onSkip}
              className="text-sm text-slate-400 hover:text-white transition-colors"
            >
              Skip
            </button>
          )}
        </div>
      </div>

      {/* Error State */}
      {discoverError && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <Icons.AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="text-red-400 font-medium">Error</div>
              <div className="text-red-300 text-sm mt-1">{discoverError}</div>
              <button
                onClick={() => {
                  setDiscoverError(null);
                  if (!hasDiscovered) handleDiscoverSuppliers();
                }}
                className="mt-3 text-sm bg-red-500/20 hover:bg-red-500/30 text-red-300 px-3 py-1.5 rounded transition-colors"
              >
                Try Again
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Scanning Progress */}
      {isScanning && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <Icons.Loader2 className="w-5 h-5 text-orange-400 animate-spin" />
              <span className="text-white font-medium">Importing Orders</span>
            </div>
            {jobStatus?.progress && (
              <span className="text-slate-400 text-sm font-mono">
                {jobStatus.progress.processed} / {jobStatus.progress.total}
              </span>
            )}
          </div>

          {jobStatus?.progress && (
            <>
              <div className="h-2 bg-slate-700 rounded-full overflow-hidden mb-3">
                <div 
                  className="h-full bg-gradient-to-r from-orange-500 to-orange-400 transition-all duration-300"
                  style={{ 
                    width: `${(jobStatus.progress.processed / jobStatus.progress.total) * 100}%` 
                  }}
                />
              </div>
              
              <div className="flex justify-between text-sm">
                <span className="text-green-400">
                  ✓ {jobStatus.progress.success} orders found
                </span>
                <span className="text-slate-500 text-xs">
                  {jobStatus.progress.currentTask}
                </span>
              </div>
            </>
          )}

          {/* Live Results */}
          {extractedOrders.length > 0 && (
            <div className="border-t border-slate-700 mt-4 pt-4">
              <div className="text-xs text-slate-500 mb-2">Recent:</div>
              <div className="flex flex-wrap gap-2">
                {extractedOrders.slice(-6).reverse().map((order, i) => (
                  <div key={order.id || i} className="text-xs bg-slate-900 text-slate-300 px-2 py-1 rounded">
                    {order.supplier} • {order.items.length} items
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Scan Complete */}
      {!isScanning && jobStatus?.status === 'completed' && extractedOrders.length > 0 && (
        <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Icons.CheckCircle2 className="w-6 h-6 text-green-400" />
              <div>
                <div className="text-green-400 font-medium">Import Complete</div>
                <div className="text-green-300/70 text-sm">
                  {extractedOrders.length} orders from {Object.keys(ordersBySupplier).length} suppliers
                </div>
              </div>
            </div>
            <button
              onClick={handleComplete}
              className="bg-green-500 hover:bg-green-600 text-white px-5 py-2 rounded-lg font-medium transition-colors"
            >
              Continue →
            </button>
          </div>
        </div>
      )}

      {/* Supplier Grid - Square Tiles */}
      {!isScanning && !jobStatus?.status && (
        <>
          {isDiscovering ? (
            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-8 text-center">
              <Icons.Loader2 className="w-8 h-8 text-orange-400 animate-spin mx-auto mb-3" />
              <div className="text-white font-medium">{discoveryProgress}</div>
              <div className="text-slate-500 text-sm mt-1">This may take a moment...</div>
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
              {suppliers.map((supplier) => {
                const isEnabled = enabledSuppliers.has(supplier.domain);
                const isPriority = PRIORITY_SUPPLIERS.some(p => p.domain === supplier.domain);
                const colors = CATEGORY_COLORS[supplier.category] || CATEGORY_COLORS.unknown;
                const orderCount = ordersBySupplier[supplier.displayName]?.length || 0;
                
                return (
                  <div
                    key={supplier.domain}
                    onClick={() => handleToggleSupplier(supplier.domain)}
                    className={`
                      relative aspect-square p-3 rounded-xl border-2 cursor-pointer transition-all
                      flex flex-col items-center justify-center text-center
                      ${isEnabled 
                        ? 'bg-slate-800 border-orange-500 shadow-lg shadow-orange-500/10' 
                        : 'bg-slate-900 border-slate-700 hover:border-slate-600 opacity-60 hover:opacity-100'
                      }
                    `}
                  >
                    {/* Priority indicator */}
                    {isPriority && (
                      <div className="absolute top-1 right-1 w-2 h-2 bg-orange-500 rounded-full" />
                    )}

                    {/* Checkmark when enabled */}
                    {isEnabled && (
                      <div className="absolute top-1.5 left-1.5">
                        <Icons.CheckCircle2 className="w-4 h-4 text-orange-400" />
                      </div>
                    )}

                    {/* Category Icon */}
                    <div className={`text-2xl mb-1 ${isEnabled ? '' : 'grayscale'}`}>
                      {colors.icon}
                    </div>

                    {/* Supplier Name */}
                    <div className={`text-xs font-medium truncate w-full ${isEnabled ? 'text-white' : 'text-slate-400'}`}>
                      {supplier.displayName}
                    </div>

                    {/* Email count */}
                    {supplier.emailCount > 0 && (
                      <div className="text-[10px] text-slate-500 mt-0.5">
                        {supplier.emailCount} emails
                      </div>
                    )}

                    {/* Order count if scanned */}
                    {orderCount > 0 && (
                      <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 text-[10px] text-green-400 font-medium">
                        ✓ {orderCount}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Action Bar */}
          {!isDiscovering && (
            <div className="flex items-center justify-between pt-4 border-t border-slate-800">
              <div className="flex items-center gap-4">
                <span className="text-sm text-slate-500">
                  {enabledCount} selected
                </span>
                {hasDiscovered && (
                  <button
                    onClick={handleDiscoverSuppliers}
                    className="text-sm text-slate-400 hover:text-white transition-colors flex items-center gap-1"
                  >
                    <Icons.RefreshCw className="w-3 h-3" />
                    Refresh
                  </button>
                )}
              </div>
              <button
                onClick={handleStartScan}
                disabled={enabledCount === 0}
                className="px-6 py-2.5 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors flex items-center gap-2"
              >
                <Icons.Download className="w-4 h-4" />
                Import Order History
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default SupplierSetup;
