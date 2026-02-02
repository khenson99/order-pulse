import { useState, useCallback, useMemo } from 'react';
import { Icons } from '../components/Icons';
import { ExtractedOrder } from '../types';
import { buildVelocityProfiles } from '../utils/inventoryLogic';
import { SupplierSetup, EmailScanState } from './SupplierSetup';
import { BarcodeScanStep } from './BarcodeScanStep';
import { PhotoCaptureStep } from './PhotoCaptureStep';
import { CSVUploadStep, CSVItem } from './CSVUploadStep';
import { MasterListStep, MasterListItem } from './MasterListStep';
import { ArdaSyncStep } from './ArdaSyncStep';

// Simple email item for onboarding (before full InventoryItem processing)
interface EmailItem {
  id: string;
  name: string;
  supplier: string;
  asin?: string;
  imageUrl?: string;
  lastPrice?: number;
  quantity?: number;
  location?: string;
  recommendedMin?: number;
  recommendedOrderQty?: number;
}

// Onboarding step definitions
export type OnboardingStep = 'email' | 'barcode' | 'photo' | 'csv' | 'masterlist' | 'sync';

interface StepConfig {
  id: OnboardingStep;
  number: number;
  title: string;
  description: string;
  icon: keyof typeof Icons;
}

const ONBOARDING_STEPS: StepConfig[] = [
  {
    id: 'email',
    number: 1,
    title: 'Link Email',
    description: 'Import orders from your inbox',
    icon: 'Mail',
  },
  {
    id: 'barcode',
    number: 2,
    title: 'Scan Barcodes',
    description: 'Scan UPC/EAN codes in your shop',
    icon: 'Barcode',
  },
  {
    id: 'photo',
    number: 3,
    title: 'Capture Items',
    description: 'Photograph items with labels',
    icon: 'Camera',
  },
  {
    id: 'csv',
    number: 4,
    title: 'Upload CSV',
    description: 'Import from spreadsheet',
    icon: 'FileSpreadsheet',
  },
  {
    id: 'masterlist',
    number: 5,
    title: 'Review Items',
    description: 'Verify and enrich data',
    icon: 'ListChecks',
  },
  {
    id: 'sync',
    number: 6,
    title: 'Sync to Arda',
    description: 'Push items to inventory',
    icon: 'Upload',
  },
];

// Scanned barcode item
export interface ScannedBarcode {
  id: string;
  barcode: string;
  barcodeType: 'UPC' | 'EAN' | 'UPC-A' | 'EAN-13' | 'unknown';
  scannedAt: string;
  source: 'desktop' | 'mobile';
  // Enriched data from lookup
  productName?: string;
  brand?: string;
  imageUrl?: string;
  category?: string;
  // Match status
  matchedToEmailItem?: string;
}

// Captured item photo
export interface CapturedPhoto {
  id: string;
  imageData: string;
  capturedAt: string;
  source: 'desktop' | 'mobile';
  // Extracted data from image analysis
  extractedText?: string[];
  detectedBarcodes?: string[];
  suggestedName?: string;
  suggestedSupplier?: string;
  isInternalItem?: boolean;
}

// Unified item for reconciliation (kept for backwards compatibility)
export interface ReconciliationItem {
  id: string;
  source: 'email' | 'barcode' | 'photo' | 'csv';
  name: string;
  normalizedName?: string;
  supplier?: string;
  location?: string;
  barcode?: string;
  sku?: string;
  asin?: string;
  quantity?: number;
  minQty?: number;
  orderQty?: number;
  unitPrice?: number;
  imageUrl?: string;
  productUrl?: string;
  duplicateOf?: string;
  isDuplicate?: boolean;
  matchConfidence?: number;
  isApproved?: boolean;
  isExcluded?: boolean;
  needsReview?: boolean;
}

interface OnboardingFlowProps {
  onComplete: (items: MasterListItem[]) => void;
  onSkip: () => void;
  userProfile?: { name?: string; email?: string };
}

// Background email progress state
interface BackgroundEmailProgress {
  isActive: boolean;
  supplier: string;
  processed: number;
  total: number;
  currentTask?: string;
}

export const OnboardingFlow: React.FC<OnboardingFlowProps> = ({
  onComplete,
  onSkip,
  userProfile,
}) => {
  const [currentStep, setCurrentStep] = useState<OnboardingStep>('email');
  const [completedSteps, setCompletedSteps] = useState<Set<OnboardingStep>>(new Set());
  
  // Data from each step
  const [, setEmailOrders] = useState<ExtractedOrder[]>([]);
  const [emailItems, setEmailItems] = useState<EmailItem[]>([]);
  const [scannedBarcodes, setScannedBarcodes] = useState<ScannedBarcode[]>([]);
  const [capturedPhotos, setCapturedPhotos] = useState<CapturedPhoto[]>([]);
  const [csvItems, setCsvItems] = useState<CSVItem[]>([]);
  const [masterListItems, setMasterListItems] = useState<MasterListItem[]>([]);
  
  // Background email scanning progress
  const [emailProgress, setEmailProgress] = useState<BackgroundEmailProgress | null>(null);
  
  // Track when user can proceed from email step (Amazon + priority done)
  const [canProceedFromEmail, setCanProceedFromEmail] = useState(false);
  
  // Preserve email scan state for navigation
  const [emailScanState, setEmailScanState] = useState<EmailScanState | undefined>(undefined);
  
  // Mobile session ID for syncing
  const [mobileSessionId] = useState(() => 
    `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  );

  // Calculate total items across all sources
  const totalItems = emailItems.length + scannedBarcodes.length + capturedPhotos.filter(p => p.suggestedName).length + csvItems.length;

  // Get current step index
  const currentStepIndex = ONBOARDING_STEPS.findIndex(s => s.id === currentStep);
  const currentStepConfig = useMemo(
    () => ONBOARDING_STEPS.find(s => s.id === currentStep) || ONBOARDING_STEPS[0],
    [currentStep],
  );
  
  // Check if can go back
  const canGoBack = currentStepIndex > 0;
  
  // Check if can go forward
  // Some steps have their own primary action (e.g. CSV approve, master list review, sync).
  // For those, we hide the global footer "Continue" to avoid accidental skipping.
  const showFooterContinue = currentStep !== 'sync' && currentStep !== 'csv' && currentStep !== 'masterlist';
  const canGoForward = showFooterContinue && (
    currentStep === 'email'
      ? canProceedFromEmail
      : true
  );

  // Handle step completion
  const handleStepComplete = useCallback((step: OnboardingStep) => {
    setCompletedSteps(prev => new Set([...prev, step]));
    
    // Auto-advance to next step
    const currentIndex = ONBOARDING_STEPS.findIndex(s => s.id === step);
    if (currentIndex < ONBOARDING_STEPS.length - 1) {
      setCurrentStep(ONBOARDING_STEPS[currentIndex + 1].id);
    }
  }, []);

  // Handle email orders update (does NOT auto-advance - user clicks Continue)
  const handleEmailOrdersUpdate = useCallback((orders: ExtractedOrder[]) => {
    setEmailOrders(orders);
    
    // Build velocity profiles using ReLoWiSa calculations
    // This calculates recommended min/order qty based on:
    // - Pack size (NPK) from Amazon enrichment
    // - Order frequency (Takt time)
    // - Assumed lead time with safety factor
    const velocityProfiles = buildVelocityProfiles(orders);
    
    // Convert orders to email items with velocity-based recommendations
    const items: EmailItem[] = orders.flatMap(order => 
      order.items.map(item => {
        // Find velocity profile for this item
        const normalizedName = item.normalizedName || item.name.toLowerCase().trim();
        const profile = velocityProfiles.get(normalizedName);
        
        // Use Amazon enriched name if available
        const displayName = item.amazonEnriched?.humanizedName || 
                           item.amazonEnriched?.itemName || 
                           item.name;
        
        return {
          id: `email-${order.id}-${item.name}`,
          name: displayName,
          supplier: order.supplier,
          asin: item.asin,
          imageUrl: item.amazonEnriched?.imageUrl,
          lastPrice: item.unitPrice,
          quantity: item.quantity,
          // Use ReLoWiSa-calculated recommendations from velocity profile
          recommendedMin: profile?.recommendedMin || Math.ceil((item.quantity || 1) * 1.5),
          recommendedOrderQty: profile?.recommendedOrderQty || item.quantity || 1,
        };
      })
    );
    
    // Dedupe by normalized name to avoid duplicate items
    const uniqueItems = new Map<string, EmailItem>();
    items.forEach(item => {
      const key = item.name.toLowerCase().trim();
      if (!uniqueItems.has(key) || (item.imageUrl && !uniqueItems.get(key)?.imageUrl)) {
        uniqueItems.set(key, item);
      }
    });
    
    setEmailItems(Array.from(uniqueItems.values()));
    // Don't auto-advance - user will click Continue when ready
  }, []);

  // Handle barcode scan
  const handleBarcodeScanned = useCallback((barcode: ScannedBarcode) => {
    setScannedBarcodes(prev => {
      if (prev.some(b => b.barcode === barcode.barcode)) {
        return prev;
      }
      return [...prev, barcode];
    });
  }, []);

  // Handle photo capture
  const handlePhotoCaptured = useCallback((photo: CapturedPhoto) => {
    setCapturedPhotos(prev => {
      // Update existing photo or add new
      const existingIndex = prev.findIndex(p => p.id === photo.id);
      if (existingIndex >= 0) {
        const updated = [...prev];
        updated[existingIndex] = photo;
        return updated;
      }
      return [...prev, photo];
    });
  }, []);

  // Handle CSV upload completion
  const handleCSVComplete = useCallback((approvedItems: CSVItem[]) => {
    setCsvItems(approvedItems);
    handleStepComplete('csv');
  }, [handleStepComplete]);

  // Handle master list completion
  const handleMasterListComplete = useCallback((items: MasterListItem[]) => {
    setMasterListItems(items);
    handleStepComplete('masterlist');
  }, [handleStepComplete]);

  // Handle final sync complete
  const handleSyncComplete = useCallback(() => {
    handleStepComplete('sync');
    onComplete(masterListItems);
  }, [handleStepComplete, onComplete, masterListItems]);

  // Update email progress from child component
  const handleEmailProgressUpdate = useCallback((progress: BackgroundEmailProgress | null) => {
    setEmailProgress(progress);
  }, []);

  // Handle when user can proceed from email step (key suppliers done)
  const handleCanProceedFromEmail = useCallback((canProceed: boolean) => {
    setCanProceedFromEmail(canProceed);
  }, []);

  // Preserve email scan state for navigation
  const handleEmailScanStateChange = useCallback((state: EmailScanState) => {
    setEmailScanState(state);
  }, []);

  // Go to previous step
  const goBack = useCallback(() => {
    if (currentStepIndex > 0) {
      setCurrentStep(ONBOARDING_STEPS[currentStepIndex - 1].id);
    }
  }, [currentStepIndex]);

  // Go to next step
  const goForward = useCallback(() => {
    if (currentStepIndex < ONBOARDING_STEPS.length - 1) {
      handleStepComplete(currentStep);
    }
  }, [currentStepIndex, currentStep, handleStepComplete]);

  // Get step status
  const getStepStatus = (stepId: OnboardingStep): 'completed' | 'current' | 'upcoming' => {
    if (completedSteps.has(stepId)) return 'completed';
    if (currentStep === stepId) return 'current';
    return 'upcoming';
  };

  // Render step indicator
  const renderStepIndicator = () => (
    <div className="sticky top-0 z-40 border-b border-arda-border/70 bg-white/70 backdrop-blur">
      <div className="max-w-6xl mx-auto px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-orange-500 to-orange-600 shadow-arda flex items-center justify-center">
              <Icons.Package className="w-5 h-5 text-white" />
            </div>
            <div className="leading-tight">
              <div className="text-sm font-semibold text-arda-text-primary">Arda</div>
              <div className="text-xs text-arda-text-muted">Order Pulse onboarding</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {userProfile?.email && (
              <div className="hidden sm:flex items-center gap-2 text-sm text-arda-text-secondary bg-white/70 border border-arda-border rounded-xl px-3 py-2">
                <Icons.Mail className="w-4 h-4 text-arda-text-muted" />
                <span className="max-w-[18rem] truncate">{userProfile.email}</span>
              </div>
            )}
            <button
              type="button"
              onClick={onSkip}
              className="text-sm font-medium text-arda-text-muted hover:text-arda-text-primary hover:bg-white/70 border border-transparent hover:border-arda-border rounded-xl px-3 py-2 transition-colors"
            >
              Exit
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
          <div>
            <div className="text-xs text-arda-text-muted">
              Step {currentStepIndex + 1} of {ONBOARDING_STEPS.length}
            </div>
            <h1 className="text-2xl font-bold text-arda-text-primary tracking-tight">
              {currentStepConfig.title}
            </h1>
            <p className="text-sm text-arda-text-secondary mt-1">{currentStepConfig.description}</p>
          </div>

          <div className="flex items-center gap-2 flex-wrap justify-start lg:justify-end">
            {totalItems > 0 && (
              <span className="arda-pill">
                <Icons.Sparkles className="w-4 h-4" />
                {totalItems} item{totalItems === 1 ? '' : 's'} captured
              </span>
            )}

            {emailProgress && emailProgress.isActive && currentStep === 'email' && (
              <span className="inline-flex items-center gap-2 text-xs font-medium text-arda-text-secondary bg-white/70 border border-arda-border rounded-full px-3 py-1.5">
                <Icons.Loader2 className="w-3.5 h-3.5 animate-spin text-arda-accent" />
                Scanning {emailProgress.supplier} ({emailProgress.processed}/{emailProgress.total})
              </span>
            )}
          </div>
        </div>

        <div className="mt-4 overflow-x-auto pb-2">
          <div className="flex items-center min-w-max">
            {ONBOARDING_STEPS.map((step, index) => {
              const status = getStepStatus(step.id);
              const Icon = Icons[step.icon] || Icons.Circle;

              const isInteractive = status === 'completed' || status === 'current';
              const isCompleted = status === 'completed';
              const isCurrent = status === 'current';

              return (
                <div key={step.id} className="flex items-center">
                  <button
                    type="button"
                    onClick={() => {
                      if (isInteractive) setCurrentStep(step.id);
                    }}
                    disabled={!isInteractive}
                    className={[
                      'group flex items-center gap-2 rounded-xl px-3 py-2 transition-all whitespace-nowrap border',
                      isCurrent ? 'bg-orange-50 border-orange-200' : 'bg-white/70 border-arda-border hover:bg-white',
                      !isInteractive ? 'opacity-50 cursor-not-allowed' : '',
                    ].join(' ')}
                    aria-current={isCurrent ? 'step' : undefined}
                  >
                    <span
                      className={[
                        'w-8 h-8 rounded-xl flex items-center justify-center',
                        'border transition-colors',
                        isCompleted ? 'bg-arda-accent border-orange-600 text-white' : '',
                        isCurrent ? 'bg-orange-500 border-orange-600 text-white' : '',
                        status === 'upcoming' ? 'bg-arda-bg-tertiary border-arda-border text-arda-text-muted' : '',
                      ].join(' ')}
                    >
                      {isCompleted ? <Icons.Check className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
                    </span>
                    <span
                      className={[
                        'text-sm font-medium',
                        isCurrent ? 'text-arda-text-primary' : 'text-arda-text-secondary group-hover:text-arda-text-primary',
                      ].join(' ')}
                    >
                      {step.title}
                    </span>
                  </button>

                  {index < ONBOARDING_STEPS.length - 1 && (
                    <div
                      className={[
                        'w-8 h-[2px] mx-2 rounded-full',
                        completedSteps.has(step.id) ? 'bg-orange-400' : 'bg-arda-border',
                      ].join(' ')}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );

  // Render current step content
  const renderStepContent = () => {
    switch (currentStep) {
      case 'email':
        return (
          <SupplierSetup
            onScanComplete={handleEmailOrdersUpdate}
            onSkip={() => handleStepComplete('email')}
            onProgressUpdate={handleEmailProgressUpdate}
            onCanProceed={handleCanProceedFromEmail}
            onStateChange={handleEmailScanStateChange}
            initialState={emailScanState}
          />
        );
      
      case 'barcode':
        return (
          <BarcodeScanStep
            sessionId={mobileSessionId}
            scannedBarcodes={scannedBarcodes}
            onBarcodeScanned={handleBarcodeScanned}
            onComplete={() => handleStepComplete('barcode')}
            onBack={() => setCurrentStep('email')}
          />
        );
      
      case 'photo':
        return (
          <PhotoCaptureStep
            sessionId={mobileSessionId}
            capturedPhotos={capturedPhotos}
            onPhotoCaptured={handlePhotoCaptured}
            onComplete={() => handleStepComplete('photo')}
            onBack={() => setCurrentStep('barcode')}
          />
        );

      case 'csv':
        return (
          <CSVUploadStep
            onComplete={handleCSVComplete}
            onBack={() => setCurrentStep('photo')}
          />
        );

      case 'masterlist':
        return (
          <MasterListStep
            emailItems={emailItems}
            scannedBarcodes={scannedBarcodes}
            capturedPhotos={capturedPhotos}
            csvItems={csvItems}
            onComplete={handleMasterListComplete}
            onBack={() => setCurrentStep('csv')}
          />
        );

      case 'sync':
        return (
          <ArdaSyncStep
            items={masterListItems}
            userEmail={userProfile?.email}
            onComplete={handleSyncComplete}
            onBack={() => setCurrentStep('masterlist')}
          />
        );
      
      default:
        return null;
    }
  };

  // Render persistent footer
  const renderFooter = () => (
    <div className="sticky bottom-0 z-40 bg-white/80 backdrop-blur border-t border-arda-border shadow-arda-lg">
      <div className="max-w-6xl mx-auto px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          {/* Left: Back */}
          <div className="min-w-[7.5rem]">
            {canGoBack && (
              <button
                type="button"
                onClick={goBack}
                className="btn-arda-outline flex items-center gap-2"
              >
                <Icons.ChevronLeft className="w-4 h-4" />
                Back
              </button>
            )}
          </div>

          {/* Center: Progress + counts */}
          <div className="flex-1 flex flex-col items-center text-center">
            <div className="text-sm font-medium text-arda-text-secondary">
              Step {currentStepIndex + 1} of {ONBOARDING_STEPS.length}
            </div>

            <div className="flex items-center gap-4 mt-1 text-xs text-arda-text-muted flex-wrap justify-center">
              {emailItems.length > 0 && (
                <span className="inline-flex items-center gap-1">
                  <Icons.Mail className="w-3 h-3" />
                  {emailItems.length} email
                </span>
              )}
              {scannedBarcodes.length > 0 && (
                <span className="inline-flex items-center gap-1">
                  <Icons.Barcode className="w-3 h-3" />
                  {scannedBarcodes.length} scanned
                </span>
              )}
              {capturedPhotos.filter(p => p.suggestedName).length > 0 && (
                <span className="inline-flex items-center gap-1">
                  <Icons.Camera className="w-3 h-3" />
                  {capturedPhotos.filter(p => p.suggestedName).length} photos
                </span>
              )}
              {csvItems.length > 0 && (
                <span className="inline-flex items-center gap-1">
                  <Icons.FileSpreadsheet className="w-3 h-3" />
                  {csvItems.length} CSV
                </span>
              )}
              {totalItems > 0 && (
                <span className="text-arda-text-secondary font-medium">
                  ({totalItems} total)
                </span>
              )}
            </div>

            {emailProgress && emailProgress.isActive && currentStep === 'email' && (
              <div className="mt-2 inline-flex items-center gap-2 text-xs text-arda-text-secondary bg-white/70 border border-arda-border rounded-full px-3 py-1">
                <Icons.Loader2 className="w-3 h-3 animate-spin text-arda-accent" />
                <span>
                  Scanning {emailProgress.supplier}: {emailProgress.processed}/{emailProgress.total}
                </span>
              </div>
            )}
          </div>

          {/* Right: Primary CTA */}
          <div className="min-w-[7.5rem] flex justify-end">
            {showFooterContinue && (
              <button
                type="button"
                onClick={goForward}
                disabled={!canGoForward}
                className={[
                  'flex items-center gap-2 px-4 py-2 rounded-arda font-semibold text-sm transition-colors',
                  canGoForward
                    ? 'bg-arda-accent text-white hover:bg-arda-accent-hover'
                    : 'bg-arda-border text-arda-text-muted cursor-not-allowed',
                ].join(' ')}
              >
                Continue
                <Icons.ChevronRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="relative min-h-screen arda-mesh flex flex-col">
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-10 left-10 w-56 h-56 rounded-full bg-orange-400/15 blur-3xl animate-float" />
        <div className="absolute top-32 right-12 w-72 h-72 rounded-full bg-blue-500/10 blur-3xl animate-float" />
      </div>
      {/* Step indicator */}
      {renderStepIndicator()}
      
      {/* Main content */}
      <div className="relative z-10 flex-1 px-6 py-6 pb-28">
        <div className="max-w-6xl mx-auto">
          {renderStepContent()}
        </div>
      </div>

      {/* Persistent footer */}
      {renderFooter()}
    </div>
  );
};
