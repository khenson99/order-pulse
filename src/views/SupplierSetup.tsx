import { useState, useEffect, useCallback, useRef } from 'react';
import { Icons } from '../components/Icons';
import { SupplierConfig } from '../components/SupplierConfig';
import { ExtractedOrder } from '../types';
import { discoverApi, jobsApi, JobStatus, DiscoveredSupplier } from '../services/api';

interface SupplierSetupProps {
  onScanComplete: (orders: ExtractedOrder[]) => void;
  onSkip: () => void;
}

type Step = 'discover' | 'configure' | 'scan';

export const SupplierSetup: React.FC<SupplierSetupProps> = ({
  onScanComplete,
  onSkip,
}) => {
  const [currentStep, setCurrentStep] = useState<Step>('discover');
  const [discoveredSuppliers, setDiscoveredSuppliers] = useState<DiscoveredSupplier[]>([]);
  const [enabledSuppliers, setEnabledSuppliers] = useState<string[]>([]);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [currentlyScanning, setCurrentlyScanning] = useState<string | null>(null);
  const [scanResults, setScanResults] = useState<{ domain: string; orderCount: number }[]>([]);
  
  // Job polling state
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll for job status during scanning
  const pollJobStatus = useCallback(async () => {
    if (!currentJobId) return;
    
    try {
      const status = await jobsApi.getStatus(currentJobId);
      setJobStatus(status);
      
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
        
        // Group orders by supplier domain for scan results
        const resultsByDomain: Record<string, number> = {};
        convertedOrders.forEach(order => {
          const domain = order.supplier.toLowerCase().replace(/\s+/g, '');
          resultsByDomain[domain] = (resultsByDomain[domain] || 0) + 1;
        });
        
        setScanResults(
          Object.entries(resultsByDomain).map(([domain, count]) => ({
            domain,
            orderCount: count,
          }))
        );
        
        // If job is complete, call onScanComplete
        if (status.status === 'completed') {
          setIsScanning(false);
          setCurrentlyScanning(null);
          onScanComplete(convertedOrders);
        }
      }
      
      if (status.status === 'completed' || status.status === 'failed') {
        setIsScanning(false);
        setCurrentlyScanning(null);
        if (pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
        
        if (status.status === 'failed' && status.error) {
          console.error('Scan failed:', status.error);
        }
      }
    } catch (error) {
      console.error('Polling error:', error);
    }
  }, [currentJobId, onScanComplete]);

  // Start polling when scanning
  useEffect(() => {
    if (isScanning && currentJobId) {
      pollJobStatus(); // Poll immediately
      pollingRef.current = setInterval(pollJobStatus, 1000);
      return () => {
        if (pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
      };
    }
  }, [isScanning, currentJobId, pollJobStatus]);

  const [discoverError, setDiscoverError] = useState<string | null>(null);

  const handleDiscoverSuppliers = async () => {
    setIsDiscovering(true);
    setDiscoverError(null);
    try {
      const response = await discoverApi.discoverSuppliers();
      setDiscoveredSuppliers(response.suppliers);
      // Auto-enable recommended suppliers by default
      setEnabledSuppliers(response.suppliers.filter(s => s.isRecommended).map(s => s.domain));
      setCurrentStep('configure');
    } catch (error: any) {
      console.error('Failed to discover suppliers:', error);
      const errorMsg = error.message || 'Failed to discover suppliers';
      setDiscoverError(errorMsg);
    } finally {
      setIsDiscovering(false);
    }
  };

  const handleToggleSupplier = (domain: string) => {
    setEnabledSuppliers(prev =>
      prev.includes(domain)
        ? prev.filter(d => d !== domain)
        : [...prev, domain]
    );
  };

  const handleToggleAll = () => {
    if (enabledSuppliers.length === discoveredSuppliers.length) {
      setEnabledSuppliers([]);
    } else {
      setEnabledSuppliers(discoveredSuppliers.map(s => s.domain));
    }
  };

  const handleScanAll = async () => {
    if (enabledSuppliers.length === 0) {
      alert('Please enable at least one supplier before scanning.');
      return;
    }

    setIsScanning(true);
    setCurrentlyScanning(null); // Scanning all, not a specific one
    setScanResults([]);
    
    try {
      const response = await discoverApi.startJobWithFilter(enabledSuppliers);
      setCurrentJobId(response.jobId);
      setCurrentStep('scan');
    } catch (error) {
      console.error('Failed to start scan:', error);
      alert('Failed to start scan. Please try again.');
      setIsScanning(false);
      setCurrentlyScanning(null);
    }
  };

  const handleScanSupplier = async (domain: string) => {
    setIsScanning(true);
    setCurrentlyScanning(domain);
    setScanResults([]);
    
    try {
      const response = await discoverApi.startJobWithFilter([domain]);
      setCurrentJobId(response.jobId);
      setCurrentStep('scan');
    } catch (error) {
      console.error('Failed to start scan:', error);
      alert('Failed to start scan. Please try again.');
      setIsScanning(false);
      setCurrentlyScanning(null);
    }
  };

  const getStepNumber = (step: Step): number => {
    const steps: Step[] = ['discover', 'configure', 'scan'];
    return steps.indexOf(step) + 1;
  };

  const isStepComplete = (step: Step): boolean => {
    if (step === 'discover') return discoveredSuppliers.length > 0;
    if (step === 'configure') return enabledSuppliers.length > 0;
    if (step === 'scan') return jobStatus?.status === 'completed';
    return false;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-arda-text-primary">Supplier Setup</h2>
          <p className="text-arda-text-secondary">Configure suppliers to scan for orders</p>
        </div>
        <button
          onClick={onSkip}
          className="text-sm text-arda-text-secondary hover:text-arda-text-primary"
        >
          Skip Setup
        </button>
      </div>

      {/* Step Indicator */}
      <div className="flex items-center justify-between max-w-2xl">
        {(['discover', 'configure', 'scan'] as Step[]).map((step, index) => {
          const stepNum = index + 1;
          const isActive = currentStep === step;
          const isComplete = isStepComplete(step);
          const isPast = getStepNumber(currentStep) > stepNum;

          return (
            <div key={step} className="flex items-center flex-1">
              <div className="flex flex-col items-center flex-1">
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold text-sm border-2 transition-colors ${
                    isActive
                      ? 'bg-arda-accent text-white border-arda-accent'
                      : isComplete || isPast
                      ? 'bg-arda-success text-white border-arda-success'
                      : 'bg-white text-arda-text-muted border-arda-border'
                  }`}
                >
                  {isComplete || isPast ? (
                    <Icons.CheckCircle2 className="w-5 h-5" />
                  ) : (
                    stepNum
                  )}
                </div>
                <div className="mt-2 text-xs font-medium text-arda-text-secondary capitalize">
                  {step === 'discover' ? 'Discover' : step === 'configure' ? 'Configure' : 'Scan'}
                </div>
              </div>
              {index < 2 && (
                <div
                  className={`h-0.5 flex-1 mx-2 ${
                    isPast || isComplete ? 'bg-arda-success' : 'bg-arda-border'
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Step Content */}
      <div className="bg-white border border-arda-border rounded-xl shadow-arda p-6">
        {currentStep === 'discover' && (
          <div className="space-y-6">
            <div className="text-center space-y-4">
              <div className="w-16 h-16 bg-orange-50 rounded-full flex items-center justify-center mx-auto border border-orange-100">
                <Icons.Search className="w-8 h-8 text-arda-accent" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-arda-text-primary mb-2">
                  Discover Suppliers
                </h3>
                <p className="text-arda-text-secondary max-w-md mx-auto">
                  We'll scan your email to find suppliers you've ordered from. This helps us
                  identify which suppliers to monitor for future orders.
                </p>
              </div>
            </div>

            <div className="flex justify-center">
              <button
                onClick={handleDiscoverSuppliers}
                disabled={isDiscovering}
                className="bg-arda-accent text-white px-8 py-3 rounded-lg font-medium hover:bg-arda-accent-hover flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-orange-500/20 transition-colors"
              >
                {isDiscovering ? (
                  <>
                    <Icons.Loader2 className="w-5 h-5 animate-spin" />
                    Discovering...
                  </>
                ) : (
                  <>
                    <Icons.Search className="w-5 h-5" />
                    Discover Suppliers
                  </>
                )}
              </button>
            </div>

            {isDiscovering && (
              <div className="text-center text-sm text-arda-text-secondary">
                <p>Scanning your email for supplier information...</p>
              </div>
            )}

            {discoverError && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 max-w-md mx-auto">
                <div className="flex items-start gap-3">
                  <Icons.AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <h4 className="text-sm font-medium text-red-800">Discovery Failed</h4>
                    <p className="text-sm text-red-600 mt-1">{discoverError}</p>
                    <div className="mt-3 flex gap-2">
                      <button
                        onClick={() => {
                          setDiscoverError(null);
                          handleDiscoverSuppliers();
                        }}
                        className="text-sm bg-red-100 hover:bg-red-200 text-red-700 px-3 py-1.5 rounded transition-colors"
                      >
                        Try Again
                      </button>
                      <button
                        onClick={() => {
                          // Force re-login
                          window.location.href = '/';
                        }}
                        className="text-sm bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded transition-colors"
                      >
                        Re-login
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {currentStep === 'configure' && (
          <div className="space-y-6">
            <SupplierConfig
              suppliers={discoveredSuppliers}
              enabledSuppliers={enabledSuppliers}
              onToggleSupplier={handleToggleSupplier}
              onScanSupplier={handleScanSupplier}
              onScanAllEnabled={handleScanAll}
              isLoading={isScanning}
              currentlyScanning={currentlyScanning || undefined}
            />

            <div className="flex items-center justify-between pt-4 border-t border-arda-border">
              <button
                onClick={() => setCurrentStep('discover')}
                className="text-sm text-arda-text-secondary hover:text-arda-text-primary"
              >
                ← Back
              </button>
            </div>
          </div>
        )}

        {currentStep === 'scan' && (
          <div className="space-y-6">
            <div className="text-center space-y-4">
              <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mx-auto border border-blue-100">
                {isScanning ? (
                  <Icons.Loader2 className="w-8 h-8 text-arda-info animate-spin" />
                ) : (
                  <Icons.ScanLine className="w-8 h-8 text-arda-info" />
                )}
              </div>
              <div>
                <h3 className="text-xl font-bold text-arda-text-primary mb-2">
                  {isScanning ? 'Scanning for Orders' : 'Scan Complete'}
                </h3>
                <p className="text-arda-text-secondary">
                  {isScanning
                    ? currentlyScanning
                      ? `Scanning ${currentlyScanning}...`
                      : 'Processing emails and extracting orders...'
                    : 'Orders have been extracted successfully.'}
                </p>
              </div>
            </div>

            {jobStatus?.progress && (
              <div className="space-y-2">
                <div className="flex justify-between text-xs text-arda-text-secondary font-mono">
                  <span>{jobStatus.progress.currentTask}</span>
                  <span>
                    {jobStatus.progress.processed}/{jobStatus.progress.total} (
                    {Math.round(
                      (jobStatus.progress.processed / jobStatus.progress.total) * 100
                    )}
                    %)
                  </span>
                </div>
                <div className="w-full bg-arda-bg-tertiary rounded-full h-3 overflow-hidden border border-arda-border">
                  <div
                    className="bg-gradient-to-r from-arda-accent to-orange-400 h-3 rounded-full transition-all duration-300"
                    style={{
                      width: `${
                        (jobStatus.progress.processed / jobStatus.progress.total) * 100
                      }%`,
                    }}
                  />
                </div>
                <div className="flex gap-4 text-xs">
                  <span className="text-arda-success font-medium">
                    ✓ {jobStatus.progress.success} orders
                  </span>
                  <span className="text-arda-text-muted">
                    ○ {jobStatus.progress.failed} non-order
                  </span>
                </div>
              </div>
            )}

            {scanResults.length > 0 && (
              <div className="pt-4 border-t border-arda-border">
                <h4 className="text-sm font-semibold text-arda-text-primary mb-3">
                  Scan Results:
                </h4>
                <div className="space-y-2">
                  {scanResults.map((result) => (
                    <div
                      key={result.domain}
                      className="flex items-center justify-between p-3 bg-arda-bg-secondary rounded-lg border border-arda-border"
                    >
                      <span className="text-sm text-arda-text-primary">{result.domain}</span>
                      <span className="text-sm font-medium text-arda-accent">
                        {result.orderCount} {result.orderCount === 1 ? 'order' : 'orders'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {jobStatus?.status === 'completed' && (
              <div className="flex justify-center pt-4">
                <button
                  onClick={() => {
                    setCurrentStep('configure');
                    setIsScanning(false);
                    setCurrentJobId(null);
                    setJobStatus(null);
                    setScanResults([]);
                    setCurrentlyScanning(null);
                  }}
                  className="bg-arda-accent text-white px-6 py-2.5 rounded-lg font-medium hover:bg-arda-accent-hover transition-colors"
                >
                  Scan More Suppliers
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
