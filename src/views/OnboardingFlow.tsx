import { useState, useCallback, useMemo, useEffect } from 'react';
import { Icons } from '../components/Icons';
import { ExtractedOrder } from '../types';
import { buildVelocityProfiles, normalizeItemName } from '../utils/inventoryLogic';
import { SupplierSetup, EmailScanState } from './SupplierSetup';
import { UrlScrapeStep } from './UrlScrapeStep';
import { BarcodeScanStep } from './BarcodeScanStep';
import { PhotoCaptureStep } from './PhotoCaptureStep';
import { CSVUploadStep, CSVItem, CSVFooterState } from './CSVUploadStep';
import { MasterListStep } from './MasterListStep';
import { ItemsGrid } from '../components/ItemsTable';
import type { MasterListItem, MasterListFooterState } from '../components/ItemsTable/types';
import { buildMasterListItems, mergeMasterListItems } from '../utils/masterListItems';
import { useSyncToArda } from '../hooks/useSyncToArda';
import { IntegrationsStep } from './IntegrationsStep';
import { UrlScrapedItem } from '../services/api';
import { InstructionCard } from '../components/InstructionCard';
import { OnboardingWelcomeStep } from './OnboardingWelcomeStep';

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
export type OnboardingStep = 'welcome' | 'email' | 'integrations' | 'url' | 'barcode' | 'photo' | 'csv' | 'masterlist';

interface StepConfig {
  id: OnboardingStep;
  number: number;
  title: string;
  description: string;
  icon: keyof typeof Icons;
}

const ONBOARDING_STEPS: StepConfig[] = [
  {
    id: 'welcome',
    number: 1,
    title: 'Welcome',
    description: 'Overview the onboarding path and start your sync',
    icon: 'Sparkles',
  },
  {
    id: 'email',
    number: 2,
    title: 'Email',
    description: 'Import orders from your inbox',
    icon: 'Mail',
  },
  {
    id: 'integrations',
    number: 3,
    title: 'Integrations',
    description: 'Connect your systems and data sources',
    icon: 'Building2',
  },
  {
    id: 'url',
    number: 4,
    title: 'URLs',
    description: 'Import products from links',
    icon: 'Link',
  },
  {
    id: 'barcode',
    number: 5,
    title: 'UPCs',
    description: 'Scan UPC/EAN codes in your shop',
    icon: 'Barcode',
  },
  {
    id: 'photo',
    number: 6,
    title: 'Images',
    description: 'Photograph items with labels',
    icon: 'Camera',
  },
  {
    id: 'csv',
    number: 7,
    title: 'CSV',
    description: 'Import from spreadsheet',
    icon: 'FileSpreadsheet',
  },
  {
    id: 'masterlist',
    number: 8,
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
  barcodeType: 'UPC' | 'EAN' | 'UPC-A' | 'EAN-13' | 'EAN-8' | 'GTIN-14' | 'unknown';
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

const noop = () => {};

export const OnboardingFlow: React.FC<OnboardingFlowProps> = ({
  onComplete,
  onSkip,
  userProfile,
}) => {
  const hasIntegrationCallback = (() => {
    const params = new URLSearchParams(window.location.search);
    return Boolean(params.get('integration_provider') && params.get('integration_status'));
  })();

  const [currentStep, setCurrentStep] = useState<OnboardingStep>(() => {
    return hasIntegrationCallback ? 'integrations' : 'welcome';
  });
  const [completedSteps, setCompletedSteps] = useState<Set<OnboardingStep>>(() => (
    hasIntegrationCallback ? new Set<OnboardingStep>(['welcome', 'email']) : new Set()
  ));
  const [hasStartedEmailSync, setHasStartedEmailSync] = useState(false);
  
  // Data from each step
  const [emailOrders, setEmailOrders] = useState<ExtractedOrder[]>([]);
  const emailItems = useMemo(() => buildEmailItemsFromOrders(emailOrders), [emailOrders]);
  const [urlItems, setUrlItems] = useState<UrlScrapedItem[]>([]);
  const [scannedBarcodes, setScannedBarcodes] = useState<ScannedBarcode[]>([]);
  const [capturedPhotos, setCapturedPhotos] = useState<CapturedPhoto[]>([]);
  const [csvItems, setCsvItems] = useState<CSVItem[]>([]);
  const [csvFooterState, setCsvFooterState] = useState<CSVFooterState>({
    approvedCount: 0,
    canContinue: false,
    onSkip: noop,
    onContinue: noop,
  });
  const [masterListFooterState, setMasterListFooterState] = useState<MasterListFooterState>({
    selectedCount: 0,
    syncedCount: 0,
    canSyncSelected: false,
    canComplete: false,
    isSyncing: false,
    onSyncSelected: noop,
    onComplete: noop,
  });
  
  // Background email scanning progress
  const [emailProgress, setEmailProgress] = useState<BackgroundEmailProgress | null>(null);
  
  // Track when user can proceed from email step (Amazon + priority done)
  const [canProceedFromEmail, setCanProceedFromEmail] = useState(false);
  const [canProceedFromUrl, setCanProceedFromUrl] = useState(true);
  const [urlReviewBlockMessage, setUrlReviewBlockMessage] = useState<string | null>(null);
  
  // Preserve email scan state for navigation
  const [emailScanState, setEmailScanState] = useState<EmailScanState | undefined>(undefined);
  
  // Mobile session ID for syncing
  const [mobileSessionId] = useState(() => 
    `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  );

  // === Lifted master items state ===
  const [masterItems, setMasterItems] = useState<MasterListItem[]>([]);
  const { syncStateById, setSyncStateById, syncSingleItem, syncSelectedItems, isBulkSyncing } = useSyncToArda(masterItems);

  // Merge items from all sources into masterItems
  useEffect(() => {
    const incoming = buildMasterListItems(emailItems, urlItems, scannedBarcodes, capturedPhotos, csvItems);
    setMasterItems(prev => mergeMasterListItems(prev, incoming));
  }, [emailItems, urlItems, scannedBarcodes, capturedPhotos, csvItems]);

  const isPanelVisible = masterItems.length > 0;

  const updateItem = useCallback((id: string, field: keyof MasterListItem, value: unknown) => {
    setMasterItems(prev => prev.map(item => {
      if (item.id !== id) return item;
      const updated: MasterListItem = { ...item, [field]: value };
      if (field === 'name' && value && !String(value).includes('Unknown')) {
        updated.needsAttention = false;
      }
      return updated;
    }));
    setSyncStateById(prev => {
      const existing = prev[id];
      if (!existing || existing.status === 'idle') return prev;
      return { ...prev, [id]: { status: 'idle' } };
    });
  }, [setSyncStateById]);

  const removeItem = useCallback((id: string) => {
    setMasterItems(prev => prev.filter(item => item.id !== id));
    setSyncStateById(prev => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, [setSyncStateById]);

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
  
  const canGoForward = currentStep === 'email'
    ? canProceedFromEmail
    : currentStep === 'url'
      ? canProceedFromUrl
      : true;

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
      const byIdIndex = prev.findIndex(item => item.id === barcode.id);
      if (byIdIndex >= 0) {
        const existing = prev[byIdIndex];
        const merged = { ...existing, ...barcode, id: existing.id };
        const hasChanged = JSON.stringify(existing) !== JSON.stringify(merged);
        if (!hasChanged) return prev;
        const next = [...prev];
        next[byIdIndex] = merged;
        return next;
      }

      const byBarcodeIndex = prev.findIndex(item => item.barcode === barcode.barcode);
      if (byBarcodeIndex >= 0) {
        const existing = prev[byBarcodeIndex];
        const merged = { ...existing, ...barcode, id: barcode.id };
        const hasChanged = JSON.stringify(existing) !== JSON.stringify(merged);
        if (!hasChanged) return prev;
        const next = [...prev];
        next[byBarcodeIndex] = merged;
        return next;
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
  const handleMasterListComplete = useCallback(() => {
    handleStepComplete('masterlist');
    const syncedItems = masterItems.filter(item => syncStateById[item.id]?.status === 'success');
    onComplete(syncedItems);
  }, [handleStepComplete, masterItems, onComplete, syncStateById]);

  // Update email progress from child component
  const handleEmailProgressUpdate = useCallback((progress: BackgroundEmailProgress | null) => {
    setEmailProgress(progress);
  }, []);

  // Handle when user can proceed from email step (key suppliers done)
  const handleCanProceedFromEmail = useCallback((canProceed: boolean) => {
    setCanProceedFromEmail(canProceed);
  }, []);

  const handleUrlReviewStateChange = useCallback((state: {
    pendingReviewCount: number;
    unimportedApprovedCount: number;
    totalRows: number;
    canContinue: boolean;
  }) => {
    setCanProceedFromUrl(state.canContinue);
    if (state.canContinue || state.totalRows === 0) {
      setUrlReviewBlockMessage(null);
      return;
    }
    if (state.pendingReviewCount > 0) {
      setUrlReviewBlockMessage(
        `Review every scraped row before continuing (${state.pendingReviewCount} still pending).`,
      );
      return;
    }
    if (state.unimportedApprovedCount > 0) {
      setUrlReviewBlockMessage(
        `Import approved rows before continuing (${state.unimportedApprovedCount} still not imported).`,
      );
      return;
    }
    setUrlReviewBlockMessage('Review and import URL rows before continuing.');
  }, []);

  // Preserve email scan state for navigation
  const handleEmailScanStateChange = useCallback((state: EmailScanState) => {
    setEmailScanState(state);
  }, []);

  const handleStartEmailSync = useCallback(() => {
    setHasStartedEmailSync(true);
    handleStepComplete('welcome');
  }, [handleStepComplete]);

  const handleSkipEmailSync = useCallback(() => {
    setHasStartedEmailSync(false);
    setCompletedSteps(prev => {
      const next = new Set(prev);
      next.add('welcome');
      next.add('email');
      return next;
    });
    setCurrentStep('integrations');
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
  const renderHeaderActions = () => {
    if (currentStep === 'welcome') return null;

    return (
      <div className="flex flex-col items-end gap-1">
        <div className="flex items-center gap-2 flex-wrap justify-end">
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

          {currentStep === 'email' && (
            <button
              type="button"
              onClick={() => handleStepComplete('email')}
              className="btn-arda-outline"
            >
              Skip for now
            </button>
          )}

          {currentStep === 'csv' && (
            <>
              <button
                type="button"
                onClick={csvFooterState.onSkip === noop ? () => handleCSVComplete([]) : csvFooterState.onSkip}
                className="btn-arda-outline"
              >
                Skip CSV
              </button>
              <button
                type="button"
                onClick={csvFooterState.onContinue}
                disabled={!csvFooterState.canContinue}
                className={[
                  'flex items-center gap-2 px-4 py-2 rounded-arda font-semibold text-sm transition-colors',
                  csvFooterState.canContinue
                    ? 'bg-arda-accent text-white hover:bg-arda-accent-hover'
                    : 'bg-arda-border text-arda-text-muted cursor-not-allowed',
                ].join(' ')}
              >
                Continue
                <Icons.ChevronRight className="w-4 h-4" />
              </button>
            </>
          )}

          {currentStep === 'masterlist' ? (
            <>
              <button
                type="button"
                onClick={masterListFooterState.onSyncSelected}
                disabled={!masterListFooterState.canSyncSelected}
                className="btn-arda-outline text-sm py-1.5 flex items-center gap-2 disabled:opacity-50"
              >
                {masterListFooterState.isSyncing ? (
                  <Icons.Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Icons.Upload className="w-4 h-4" />
                )}
                Sync Selected ({masterListFooterState.selectedCount})
              </button>
              <button
                type="button"
                onClick={masterListFooterState.onComplete}
                disabled={!masterListFooterState.canComplete}
                className={[
                  'flex items-center gap-2 px-4 py-2 rounded-arda font-semibold text-sm transition-colors',
                  masterListFooterState.canComplete
                    ? 'bg-arda-accent text-white hover:bg-arda-accent-hover'
                    : 'bg-arda-border text-arda-text-muted cursor-not-allowed',
                ].join(' ')}
              >
                <Icons.ArrowRight className="w-4 h-4" />
                Complete setup ({masterListFooterState.syncedCount} synced)
              </button>
            </>
          ) : currentStep !== 'csv' && (
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

        {currentStep === 'email' && (
          <p className="max-w-[18rem] text-right text-xs text-arda-text-muted">
            Continuing won’t stop email scanning. Import keeps running in the background.
          </p>
        )}
        {currentStep === 'url' && urlReviewBlockMessage && (
          <p className="max-w-[22rem] text-right text-xs text-arda-text-muted">
            {urlReviewBlockMessage}
          </p>
        )}
      </div>
    );
  };

  const renderStepIndicator = () => (
    <div className="sticky top-0 z-40 border-b border-arda-border/70 bg-white/75 backdrop-blur">
      <div className="max-w-6xl mx-auto px-4 py-2 sm:px-6">
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

        <div className="mt-1.5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
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

          <div className="flex items-center gap-2 flex-wrap justify-start lg:justify-end">
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

          {renderHeaderActions()}
        </div>

        <div className="mt-2">
          <div className="h-1.5 rounded-full bg-arda-bg-tertiary border border-arda-border overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-orange-400 to-orange-500 transition-all duration-300"
              style={{ width: `${((currentStepIndex + 1) / ONBOARDING_STEPS.length) * 100}%` }}
              role="progressbar"
              aria-label="Onboarding progress"
              aria-valuenow={currentStepIndex + 1}
              aria-valuemin={1}
              aria-valuemax={ONBOARDING_STEPS.length}
            />
          </div>
        </div>
      </div>
    </div>
  );

  // Render current step content (keep SupplierSetup mounted so background imports continue)
  const renderStepContent = () => (
    <>
      {currentStep === 'welcome' && (
        <OnboardingWelcomeStep
          steps={ONBOARDING_STEPS.filter(step => step.id !== 'welcome')}
          userProfile={userProfile}
          onStartEmailSync={handleStartEmailSync}
          onSkipEmail={handleSkipEmailSync}
        />
      )}

      <div className={currentStep === 'email' ? '' : 'hidden'}>
        {hasStartedEmailSync ? (
          <SupplierSetup
            onScanComplete={handleEmailOrdersUpdate}
            onSkip={() => handleStepComplete('email')}
            onProgressUpdate={handleEmailProgressUpdate}
            onCanProceed={handleCanProceedFromEmail}
            onStateChange={handleEmailScanStateChange}
            initialState={emailScanState}
            embedded
          />
        ) : (
          <div className="space-y-4">
            <InstructionCard
              variant="compact"
              title="What to do"
              icon="Mail"
              steps={[
                'Connect Gmail to start scanning.',
                'Wait for Amazon + priority suppliers to finish.',
                'Select any extra suppliers to import.',
              ]}
            />
            <div className="card-arda p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-arda-text-primary">Start email sync</h3>
                <p className="text-sm text-arda-text-secondary mt-1">
                  Email scanning will run in the background while you continue.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setHasStartedEmailSync(true)}
                className="btn-arda-primary"
              >
                Start email sync
              </button>
            </div>
          </div>
        )}
      </div>

      {currentStep === 'integrations' && (
        <IntegrationsStep />
      )}

      {currentStep === 'url' && (
        <UrlScrapeStep
          importedItems={urlItems}
          onImportItems={(items) => {
            setUrlItems(previousItems => {
              const merged = new Map(previousItems.map(item => [item.sourceUrl, item]));
              items.forEach(item => {
                merged.set(item.sourceUrl, item);
              });
              return Array.from(merged.values());
            });
          }}
          onDeleteImportedItem={(sourceUrl) => {
            setUrlItems(previousItems => previousItems.filter(item => item.sourceUrl !== sourceUrl));
          }}
          onReviewStateChange={handleUrlReviewStateChange}
        />
      )}
      
      {currentStep === 'barcode' && (
        <BarcodeScanStep
          sessionId={mobileSessionId}
          scannedBarcodes={scannedBarcodes}
          onBarcodeScanned={handleBarcodeScanned}
          onComplete={() => handleStepComplete('barcode')}
          onBack={() => setCurrentStep('url')}
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
          onFooterStateChange={setCsvFooterState}
        />
      )}

      {currentStep === 'masterlist' && (
        <MasterListStep
          items={masterItems}
          syncStateById={syncStateById}
          isBulkSyncing={isBulkSyncing}
          onSyncSingle={syncSingleItem}
          onSyncSelected={syncSelectedItems}
          onUpdateItem={updateItem}
          onRemoveItem={removeItem}
          onComplete={handleMasterListComplete}
          onBack={() => setCurrentStep('csv')}
          onFooterStateChange={setMasterListFooterState}
        />
      )}
    </>
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
      <div className="relative z-10 flex-1 px-4 sm:px-6 py-4 pb-20">
        <div className={
          currentStep === 'masterlist'
            ? 'max-w-none w-full'
            : isPanelVisible
              ? 'flex flex-col lg:flex-row gap-6 max-w-none'
              : 'max-w-6xl mx-auto'
        }>
          {/* Step content — left side */}
          <div className={
            isPanelVisible && currentStep !== 'masterlist'
              ? 'w-full lg:w-[40%] lg:min-w-[380px] lg:flex-shrink-0'
              : 'w-full'
          }>
            {renderStepContent()}
          </div>

          {/* AG Grid — right side panel (visible on non-masterlist steps) */}
          {isPanelVisible && currentStep !== 'masterlist' && (
            <div className="flex-1 min-w-0 lg:sticky lg:top-[72px] lg:self-start lg:max-h-[calc(100vh-72px-3rem)] overflow-hidden rounded-xl border border-arda-border bg-white shadow-sm">
              <ItemsGrid
                items={masterItems}
                onUpdateItem={updateItem}
                onRemoveItem={removeItem}
                syncStateById={syncStateById}
                onSyncSingle={syncSingleItem}
                mode="panel"
              />
            </div>
          )}

          {/* Review step — grid is full-width (rendered by MasterListStep) */}
          {currentStep === 'masterlist' && (
            <div className="w-full rounded-xl border border-arda-border bg-white shadow-sm overflow-hidden mt-4">
              <ItemsGrid
                items={masterItems}
                onUpdateItem={updateItem}
                onRemoveItem={removeItem}
                syncStateById={syncStateById}
                onSyncSingle={syncSingleItem}
                mode="fullpage"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
