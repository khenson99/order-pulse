import { useState, useCallback, useMemo } from 'react';
import { Icons } from '../components/Icons';
import { ExtractedOrder } from '../types';
import { buildVelocityProfiles, normalizeItemName } from '../utils/inventoryLogic';
import { SupplierSetup, EmailScanState } from './SupplierSetup';
import { BarcodeScanStep } from './BarcodeScanStep';
import { PhotoCaptureStep } from './PhotoCaptureStep';
import { CSVUploadStep, CSVItem } from './CSVUploadStep';
import { MasterListStep, MasterListItem } from './MasterListStep';
import { UrlScrapeStep } from './UrlScrapeStep';
import { UrlScrapedItem } from '../services/api';

// Simple email item for onboarding (before full InventoryItem processing)
interface EmailItem {
  id: string;
  name: string;
  supplier: string;
  asin?: string;
  imageUrl?: string;
  productUrl?: string;
  lastPrice?: number;
  quantity?: number;
  location?: string;
  recommendedMin?: number;
  recommendedOrderQty?: number;
}

// Onboarding step definitions
export type OnboardingStep = 'email' | 'urls' | 'barcode' | 'photo' | 'csv' | 'masterlist';

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
    title: 'Email',
    description: 'Import orders from your inbox',
    icon: 'Mail',
  },
  {
    id: 'urls',
    number: 2,
    title: 'URLs',
    description: 'Paste product links to scrape',
    icon: 'Link',
  },
  {
    id: 'barcode',
    number: 3,
    title: 'UPCs',
    description: 'Scan UPC/EAN codes in your shop',
    icon: 'Barcode',
  },
  {
    id: 'photo',
    number: 4,
    title: 'Images',
    description: 'Photograph items with labels',
    icon: 'Camera',
  },
  {
    id: 'csv',
    number: 5,
    title: 'CSV',
    description: 'Import from spreadsheet',
    icon: 'FileSpreadsheet',
  },
  {
    id: 'masterlist',
    number: 6,
    title: 'Review',
    description: 'Review and sync items',
    icon: 'ListChecks',
  },
];

const buildEmailItemsFromOrders = (orders: ExtractedOrder[]): EmailItem[] => {
  if (orders.length === 0) return [];

  const velocityProfiles = buildVelocityProfiles(orders);
  const uniqueItems = new Map<string, EmailItem>();

  orders.forEach(order => {
    order.items.forEach(item => {
      const normalizedKey = item.normalizedName ?? normalizeItemName(item.name);
      const profile = velocityProfiles.get(normalizedKey);

      const displayName = profile?.displayName
        ?? item.amazonEnriched?.humanizedName
        ?? item.amazonEnriched?.itemName
        ?? item.name;

      // Two-bin system: min qty = order qty (refill one bin when empty)
      // Use velocity profile if available, otherwise default to 1.5x last order quantity
      const minQty = profile?.recommendedMin || Math.ceil((item.quantity || 1) * 1.5);

      const emailItem: EmailItem = {
        id: `email-${order.id}-${item.name}`,
        name: displayName,
        supplier: order.supplier,
        asin: item.asin,
        imageUrl: item.amazonEnriched?.imageUrl,
        productUrl: item.amazonEnriched?.amazonUrl,
        lastPrice: item.unitPrice,
        quantity: item.quantity,
        recommendedMin: minQty,
        recommendedOrderQty: minQty, // Two-bin: order qty = min qty
      };

      const existing = uniqueItems.get(normalizedKey);
      if (!existing || (emailItem.imageUrl && !existing.imageUrl)) {
        uniqueItems.set(normalizedKey, emailItem);
      }
    });
  });

  return Array.from(uniqueItems.values());
};

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
  source: 'email' | 'url' | 'barcode' | 'photo' | 'csv';
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
  const [emailOrders, setEmailOrders] = useState<ExtractedOrder[]>([]);
  const emailItems = useMemo(() => buildEmailItemsFromOrders(emailOrders), [emailOrders]);
  const [urlItems, setUrlItems] = useState<UrlScrapedItem[]>([]);
  const [scannedBarcodes, setScannedBarcodes] = useState<ScannedBarcode[]>([]);
  const [capturedPhotos, setCapturedPhotos] = useState<CapturedPhoto[]>([]);
  const [csvItems, setCsvItems] = useState<CSVItem[]>([]);
  
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

  const capturedPhotoCount = useMemo(
    () => capturedPhotos.reduce((count, photo) => count + (photo.suggestedName ? 1 : 0), 0),
    [capturedPhotos],
  );

  const totalItems = useMemo(
    () => emailItems.length + urlItems.length + scannedBarcodes.length + capturedPhotoCount + csvItems.length,
    [emailItems.length, urlItems.length, scannedBarcodes.length, capturedPhotoCount, csvItems.length],
  );

  const { currentStepIndex, currentStepConfig } = useMemo(() => {
    const index = ONBOARDING_STEPS.findIndex(step => step.id === currentStep);
    const safeIndex = index === -1 ? 0 : index;
    return {
      currentStepIndex: safeIndex,
      currentStepConfig: ONBOARDING_STEPS[safeIndex],
    };
  }, [currentStep]);
  
  // Check if can go back
  const canGoBack = currentStepIndex > 0;
  
  // Check if can go forward
  // Some steps have their own primary action (e.g. CSV approve, review/sync).
  // For those, we hide the global footer "Continue" to avoid accidental skipping.
  const showFooterContinue = currentStep !== 'csv' && currentStep !== 'masterlist';
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

  const handleUrlItemsImport = useCallback((items: UrlScrapedItem[]) => {
    setUrlItems(prev => {
      const merged = new Map<string, UrlScrapedItem>();
      [...prev, ...items].forEach(item => {
        const key = `${item.sourceUrl}::${item.productUrl || ''}`;
        merged.set(key, item);
      });
      return Array.from(merged.values());
    });
  }, []);

  // Handle master list completion
  const handleMasterListComplete = useCallback((items: MasterListItem[]) => {
    handleStepComplete('masterlist');
    onComplete(items);
  }, [handleStepComplete, onComplete]);

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
    <div className="sticky top-0 z-40 border-b border-arda-border/70 bg-white/75 backdrop-blur">
      <div className="max-w-6xl mx-auto px-4 py-2.5 sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-orange-500 to-orange-600 shadow-arda flex items-center justify-center flex-shrink-0">
              <Icons.Package className="w-4 h-4 text-white" />
            </div>
            <div className="leading-tight min-w-0">
              <div className="text-sm font-semibold text-arda-text-primary">Arda</div>
              <div className="hidden sm:block text-[11px] text-arda-text-muted">Order Pulse onboarding</div>
            </div>
          </div>

          <div className="hidden lg:flex items-center gap-1.5 flex-1 justify-center px-4">
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
                      'w-7 h-7 rounded-full border flex items-center justify-center transition-colors',
                      isCompleted ? 'bg-arda-accent border-orange-600 text-white' : '',
                      isCurrent ? 'bg-orange-500 border-orange-600 text-white' : '',
                      status === 'upcoming' ? 'bg-white/80 border-arda-border text-arda-text-muted' : '',
                      isInteractive ? 'hover:bg-orange-50' : 'opacity-50 cursor-not-allowed',
                    ].join(' ')}
                    aria-current={isCurrent ? 'step' : undefined}
                    title={step.title}
                  >
                    {isCompleted ? <Icons.Check className="w-3 h-3" /> : <Icon className="w-3 h-3" />}
                  </button>
                  {index < ONBOARDING_STEPS.length - 1 && (
                    <div
                      className={[
                        'w-6 h-[2px] mx-1 rounded-full',
                        completedSteps.has(step.id) ? 'bg-orange-400' : 'bg-arda-border',
                      ].join(' ')}
                    />
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex items-center gap-2">
            {userProfile?.email && (
              <div className="hidden sm:flex items-center gap-2 text-xs text-arda-text-secondary bg-white/70 border border-arda-border rounded-xl px-2.5 py-1.5">
                <Icons.Mail className="w-3.5 h-3.5 text-arda-text-muted" />
                <span className="max-w-[14rem] truncate">{userProfile.email}</span>
              </div>
            )}
            <button
              type="button"
              onClick={onSkip}
              className="text-xs font-medium text-arda-text-muted hover:text-arda-text-primary hover:bg-white/70 border border-transparent hover:border-arda-border rounded-xl px-2.5 py-1.5 transition-colors"
            >
              Exit
            </button>
          </div>
        </div>

        <div className="mt-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] text-arda-text-muted">
                Step {currentStepIndex + 1} of {ONBOARDING_STEPS.length}
              </span>
              <h1 className="text-lg font-bold text-arda-text-primary tracking-tight">
                {currentStepConfig.title}
              </h1>
            </div>
            <p className="text-xs text-arda-text-secondary truncate sm:whitespace-normal">{currentStepConfig.description}</p>
          </div>

          <div className="flex items-center gap-2 flex-wrap justify-start sm:justify-end">
            {totalItems > 0 && (
              <span className="arda-pill text-xs px-2.5 py-1">
                <Icons.Sparkles className="w-3.5 h-3.5" />
                {totalItems} item{totalItems === 1 ? '' : 's'} captured
              </span>
            )}

            {emailProgress && emailProgress.isActive && currentStep === 'email' && (
              <span className="inline-flex items-center gap-2 text-[11px] font-medium text-arda-text-secondary bg-white/70 border border-arda-border rounded-full px-2.5 py-1">
                <Icons.Loader2 className="w-3 h-3 animate-spin text-arda-accent" />
                Scanning {emailProgress.supplier} ({emailProgress.processed}/{emailProgress.total})
              </span>
            )}
          </div>
        </div>

        <div className="mt-2 lg:hidden">
          <div className="h-1.5 rounded-full bg-arda-bg-tertiary border border-arda-border overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-orange-400 to-orange-500 transition-all duration-300"
              style={{ width: `${((currentStepIndex + 1) / ONBOARDING_STEPS.length) * 100}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );

  // Render current step content (keep SupplierSetup mounted so background imports continue)
  const renderStepContent = () => (
    <>
      <div className={currentStep === 'email' ? '' : 'hidden'}>
        <SupplierSetup
          onScanComplete={handleEmailOrdersUpdate}
          onSkip={() => handleStepComplete('email')}
          onProgressUpdate={handleEmailProgressUpdate}
          onCanProceed={handleCanProceedFromEmail}
          onStateChange={handleEmailScanStateChange}
          initialState={emailScanState}
        />
      </div>

      {currentStep === 'urls' && (
        <UrlScrapeStep
          importedItems={urlItems}
          onImportItems={handleUrlItemsImport}
        />
      )}
      
      {currentStep === 'barcode' && (
        <BarcodeScanStep
          sessionId={mobileSessionId}
          scannedBarcodes={scannedBarcodes}
          onBarcodeScanned={handleBarcodeScanned}
          onComplete={() => handleStepComplete('barcode')}
          onBack={() => setCurrentStep('urls')}
        />
      )}
      
      {currentStep === 'photo' && (
        <PhotoCaptureStep
          sessionId={mobileSessionId}
          capturedPhotos={capturedPhotos}
          onPhotoCaptured={handlePhotoCaptured}
          onComplete={() => handleStepComplete('photo')}
          onBack={() => setCurrentStep('barcode')}
        />
      )}

      {currentStep === 'csv' && (
        <CSVUploadStep
          onComplete={handleCSVComplete}
          onBack={() => setCurrentStep('photo')}
        />
      )}

      {currentStep === 'masterlist' && (
        <MasterListStep
          emailItems={emailItems}
          urlItems={urlItems}
          scannedBarcodes={scannedBarcodes}
          capturedPhotos={capturedPhotos}
          csvItems={csvItems}
          onComplete={handleMasterListComplete}
          onBack={() => setCurrentStep('csv')}
        />
      )}
    </>
  );

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
              {urlItems.length > 0 && (
                <span className="inline-flex items-center gap-1">
                  <Icons.Link className="w-3 h-3" />
                  {urlItems.length} URL
                  {urlItems.length === 1 ? '' : 's'}
                </span>
              )}
              {scannedBarcodes.length > 0 && (
                <span className="inline-flex items-center gap-1">
                  <Icons.Barcode className="w-3 h-3" />
                  {scannedBarcodes.length} scanned
                </span>
              )}
              {capturedPhotoCount > 0 && (
                <span className="inline-flex items-center gap-1">
                  <Icons.Camera className="w-3 h-3" />
                  {capturedPhotoCount} photos
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

            {emailProgress && emailProgress.isActive && (
              <div className="mt-2 inline-flex items-center gap-2 text-xs text-arda-text-secondary bg-white/70 border border-arda-border rounded-full px-3 py-1">
                <Icons.Loader2 className="w-3 h-3 animate-spin text-arda-accent" />
                <span>
                  Scanning {emailProgress.supplier}: {emailProgress.processed}/{emailProgress.total}
                </span>
              </div>
            )}
          </div>

          {/* Right: Primary CTA */}
          <div className="min-w-[7.5rem] flex flex-col items-end gap-2">
            {currentStep === 'email' && (
              <p className="max-w-[18rem] text-right text-xs text-arda-text-muted">
                Continuing won’t stop email scanning. Import keeps running in the background.
              </p>
            )}
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
