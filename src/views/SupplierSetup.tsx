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

const CATEGORY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  industrial: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
  retail: { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200' },
  electronics: { bg: 'bg-cyan-50', text: 'text-cyan-700', border: 'border-cyan-200' },
  office: { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' },
  food: { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200' },
  unknown: { bg: 'bg-slate-50', text: 'text-slate-600', border: 'border-slate-200' },
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
      const response = await jobsApi.startJob();
      setCurrentJobId(response.jobId);
    } catch (error) {
      console.error('Failed to start scan:', error);
      alert('Failed to start scan. Please try again.');
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
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Supplier Discovery</h1>
          <p className="text-slate-400 mt-1">
            {isDiscovering 
              ? discoveryProgress || 'Scanning your inbox...'
              : hasDiscovered 
                ? `Found ${suppliers.length} suppliers • ${enabledCount} selected`
                : 'Select suppliers to scan for orders'
            }
          </p>
        </div>
        <button
          onClick={onSkip}
          className="text-sm text-slate-400 hover:text-white transition-colors"
        >
          Skip for now
        </button>
      </div>

      {/* Discovery Progress */}
      {isDiscovering && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-orange-500/20 flex items-center justify-center">
              <Icons.Loader2 className="w-6 h-6 text-orange-400 animate-spin" />
            </div>
            <div className="flex-1">
              <div className="text-white font-medium">Discovering Suppliers</div>
              <div className="text-slate-400 text-sm">{discoveryProgress}</div>
            </div>
          </div>
          <div className="mt-4 h-1 bg-slate-700 rounded-full overflow-hidden">
            <div className="h-full bg-orange-500 animate-pulse" style={{ width: '60%' }} />
          </div>
        </div>
      )}

      {/* Error State */}
      {discoverError && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <Icons.AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="text-red-400 font-medium">Discovery Failed</div>
              <div className="text-red-300 text-sm mt-1">{discoverError}</div>
              <button
                onClick={handleDiscoverSuppliers}
                className="mt-3 text-sm bg-red-500/20 hover:bg-red-500/30 text-red-300 px-3 py-1.5 rounded transition-colors"
              >
                Try Again
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Supplier Grid */}
      {!isDiscovering && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
                  relative p-4 rounded-xl border-2 cursor-pointer transition-all
                  ${isEnabled 
                    ? 'bg-slate-800 border-orange-500' 
                    : 'bg-slate-900 border-slate-700 hover:border-slate-600'
                  }
                  ${isPriority ? 'ring-2 ring-orange-500/20' : ''}
                `}
              >
                {/* Priority Badge */}
                {isPriority && (
                  <div className="absolute -top-2 -right-2 bg-orange-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                    Priority
                  </div>
                )}

                <div className="flex items-start gap-3">
                  {/* Checkbox */}
                  <div className={`
                    w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 mt-0.5
                    ${isEnabled ? 'bg-orange-500 border-orange-500' : 'border-slate-600'}
                  `}>
                    {isEnabled && <Icons.Check className="w-3 h-3 text-white" />}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-white font-medium">{supplier.displayName}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${colors.bg} ${colors.text}`}>
                        {supplier.category}
                      </span>
                    </div>
                    
                    <div className="text-slate-500 text-sm mt-0.5">{supplier.domain}</div>
                    
                    {supplier.emailCount > 0 && (
                      <div className="text-slate-400 text-sm mt-1">
                        {supplier.emailCount} emails found
                      </div>
                    )}

                    {/* Show sample subjects */}
                    {supplier.sampleSubjects.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {supplier.sampleSubjects.slice(0, 2).map((subject, i) => (
                          <div key={i} className="text-xs text-slate-500 truncate">
                            "{subject}"
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Show extracted orders count during/after scan */}
                    {orderCount > 0 && (
                      <div className="mt-2 flex items-center gap-1.5 text-green-400 text-sm">
                        <Icons.CheckCircle2 className="w-4 h-4" />
                        <span>{orderCount} order{orderCount !== 1 ? 's' : ''} found</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Scan Progress / Results */}
      {isScanning && jobStatus && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Icons.Loader2 className="w-5 h-5 text-orange-400 animate-spin" />
              <span className="text-white font-medium">Scanning Emails</span>
            </div>
            {jobStatus.progress && (
              <span className="text-slate-400 text-sm">
                {jobStatus.progress.processed} / {jobStatus.progress.total}
              </span>
            )}
          </div>

          {/* Progress Bar */}
          {jobStatus.progress && (
            <div className="space-y-2">
              <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-orange-500 to-orange-400 transition-all duration-300"
                  style={{ 
                    width: `${(jobStatus.progress.processed / jobStatus.progress.total) * 100}%` 
                  }}
                />
              </div>
              
              <div className="flex justify-between text-sm">
                <span className="text-green-400">
                  ✓ {jobStatus.progress.success} orders extracted
                </span>
                <span className="text-slate-500">
                  {jobStatus.progress.currentTask}
                </span>
              </div>
            </div>
          )}

          {/* Live Results */}
          {extractedOrders.length > 0 && (
            <div className="border-t border-slate-700 pt-4">
              <div className="text-sm text-slate-400 mb-2">Latest extractions:</div>
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {extractedOrders.slice(-5).reverse().map((order, i) => (
                  <div key={order.id || i} className="flex items-center justify-between text-sm bg-slate-900/50 rounded-lg p-2">
                    <div className="flex items-center gap-2">
                      <Icons.Package className="w-4 h-4 text-green-400" />
                      <span className="text-white">{order.supplier}</span>
                    </div>
                    <div className="text-slate-400">
                      {order.items.length} item{order.items.length !== 1 ? 's' : ''}
                      {order.totalAmount && ` • $${order.totalAmount.toFixed(2)}`}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Scan Complete */}
      {!isScanning && jobStatus?.status === 'completed' && extractedOrders.length > 0 && (
        <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center">
              <Icons.CheckCircle2 className="w-6 h-6 text-green-400" />
            </div>
            <div className="flex-1">
              <div className="text-green-400 font-medium text-lg">Scan Complete!</div>
              <div className="text-green-300/70">
                Extracted {extractedOrders.length} orders from {Object.keys(ordersBySupplier).length} suppliers
              </div>
            </div>
            <button
              onClick={handleComplete}
              className="bg-green-500 hover:bg-green-600 text-white px-6 py-2.5 rounded-lg font-medium transition-colors"
            >
              View Results →
            </button>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      {!isScanning && !jobStatus?.status && (
        <div className="flex items-center justify-between pt-4 border-t border-slate-800">
          <div className="text-sm text-slate-500">
            {enabledCount} supplier{enabledCount !== 1 ? 's' : ''} selected
          </div>
          <div className="flex gap-3">
            {!hasDiscovered && !isDiscovering && (
              <button
                onClick={handleDiscoverSuppliers}
                className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-colors flex items-center gap-2"
              >
                <Icons.Search className="w-4 h-4" />
                Discover More
              </button>
            )}
            <button
              onClick={handleStartScan}
              disabled={enabledCount === 0}
              className="px-6 py-2.5 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors flex items-center gap-2"
            >
              <Icons.ScanLine className="w-4 h-4" />
              Scan {enabledCount} Supplier{enabledCount !== 1 ? 's' : ''}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default SupplierSetup;
