import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icons } from '../components/Icons';
import { ExtractedOrder } from '../types';
import { buildVelocityProfiles, normalizeItemName } from '../utils/inventoryLogic';
import { SupplierSetup, EmailScanState } from './SupplierSetup';
import { UrlScrapeStep } from './UrlScrapeStep';
import { PhotoCaptureStep } from './PhotoCaptureStep';
import { CSVUploadStep, CSVItem, CSVFooterState } from './CSVUploadStep';
import { MasterListStep } from './MasterListStep';
import { ItemsGrid } from '../components/ItemsTable';
import type { MasterListItem, MasterListFooterState } from '../components/ItemsTable/types';
import { buildMasterListItems } from '../utils/masterListItems';
import { useSyncToArda } from '../hooks/useSyncToArda';
import { IntegrationsStep } from './IntegrationsStep';
import { UrlScrapedItem } from '../services/api';
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
export type OnboardingStep = 'welcome' | 'email' | 'integrations' | 'url' | 'photo' | 'csv' | 'masterlist';

interface StepConfig {
  id: OnboardingStep;
  number: number;
  title: string;
  description: string;
  tipsTitle: string;
  tips: string[];
  icon: keyof typeof Icons;
}

const ONBOARDING_STEPS: StepConfig[] = [
  {
    id: 'welcome',
    number: 1,
    title: 'Welcome',
    description: 'Overview the onboarding path and start your sync',
    tipsTitle: 'What you will do',
    tips: [
      'Start email sync to import orders automatically.',
      'Add items via URLs, barcodes, photos, or CSV.',
      'Review and sync items to Arda.',
    ],
    icon: 'Sparkles',
  },
  {
    id: 'email',
    number: 2,
    title: 'Email',
    description: 'Import orders from your inbox',
    tipsTitle: 'What to do',
    tips: [
      'Connect Gmail to start scanning.',
      'Wait for Amazon + priority suppliers to finish.',
      'Select any extra suppliers to import.',
    ],
    icon: 'Mail',
  },
  {
    id: 'integrations',
    number: 3,
    title: 'Integrations',
    description: 'Connect your systems and data sources',
    tipsTitle: 'What to do',
    tips: [
      'Connect QuickBooks or Xero if you want PO data.',
      'Start a sync to pull history.',
      'Continue when ready.',
    ],
    icon: 'Building2',
  },
  {
    id: 'url',
    number: 4,
    title: 'URLs',
    description: 'Import products from links',
    tipsTitle: 'What to do',
    tips: [
      'Paste up to 50 product links.',
      'Click “Scrape URLs.”',
      'Review, edit, approve, or delete rows.',
      'Import approved rows to the master list.',
    ],
    icon: 'Link',
  },
  {
    id: 'photo',
    number: 5,
    title: 'Images',
    description: 'Photograph items with labels',
    tipsTitle: 'What to do',
    tips: [
      'Upload photos or use the phone camera.',
      'Wait for AI extraction, then edit any field as needed.',
      'Confirm details before continuing.',
    ],
    icon: 'Camera',
  },
  {
    id: 'csv',
    number: 6,
    title: 'CSV',
    description: 'Import from spreadsheet',
    tipsTitle: 'What to do',
    tips: [
      'Upload a CSV.',
      'Map columns to fields.',
      'Approve items to import.',
    ],
    icon: 'FileSpreadsheet',
  },
  {
    id: 'masterlist',
    number: 7,
    title: 'Review',
    description: 'Review and sync items',
    tipsTitle: 'What to do',
    tips: [
      'Review and edit item details in the grid below.',
      'Select items and sync to Arda.',
      'Complete setup when ready.',
    ],
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
  const [tipsOpenForStep, setTipsOpenForStep] = useState<OnboardingStep | null>(null);
  const tipsWrapperRef = useRef<HTMLDivElement | null>(null);
  
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

  const [masterItemEditsById, setMasterItemEditsById] = useState<Record<string, Partial<MasterListItem>>>({});
  const [removedMasterItemIds, setRemovedMasterItemIds] = useState<Record<string, true>>({});

  const baseMasterItems = useMemo(
    () => buildMasterListItems(emailItems, urlItems, scannedBarcodes, capturedPhotos, csvItems),
    [emailItems, urlItems, scannedBarcodes, capturedPhotos, csvItems],
  );

  const masterItems = useMemo(
    () => baseMasterItems
      .filter(item => !removedMasterItemIds[item.id])
      .map(item => {
        const override = masterItemEditsById[item.id];
        if (!override) return item;
        return { ...item, ...override };
      }),
    [baseMasterItems, masterItemEditsById, removedMasterItemIds],
  );

  const { syncStateById, setSyncStateById, syncSingleItem, syncSelectedItems, isBulkSyncing } = useSyncToArda(masterItems);

  const isPanelVisible = masterItems.length > 0;

  const updateItem = useCallback((id: string, field: keyof MasterListItem, value: unknown) => {
    setMasterItemEditsById(prev => {
      const existing = prev[id] ?? {};
      const nextOverride = { ...existing, [field]: value } as Partial<MasterListItem>;
      if (field === 'name' && value && !String(value).includes('Unknown')) {
        nextOverride.needsAttention = false;
      }
      return { ...prev, [id]: nextOverride };
    });
    setSyncStateById(prev => {
      const existing = prev[id];
      if (!existing || existing.status === 'idle') return prev;
      return { ...prev, [id]: { status: 'idle' } };
    });
  }, [setSyncStateById]);

  const removeItem = useCallback((id: string) => {
    setRemovedMasterItemIds(prev => (prev[id] ? prev : { ...prev, [id]: true }));
    setMasterItemEditsById(prev => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setSyncStateById(prev => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, [setSyncStateById]);

  const { currentStepIndex, currentStepConfig } = useMemo(() => {
    const index = ONBOARDING_STEPS.findIndex(step => step.id === currentStep);
    const safeIndex = index === -1 ? 0 : index;
    return {
      currentStepIndex: safeIndex,
      currentStepConfig: ONBOARDING_STEPS[safeIndex],
    };
  }, [currentStep]);
  const tipsOpen = tipsOpenForStep === currentStep;

  useEffect(() => {
    if (!tipsOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setTipsOpenForStep(null);
    };

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (!tipsWrapperRef.current?.contains(target)) {
        setTipsOpenForStep(null);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('pointerdown', handlePointerDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [tipsOpen]);
  
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
      setTipsOpenForStep(null);
      setCurrentStep(ONBOARDING_STEPS[currentIndex + 1].id);
    }
  }, []);

  // Handle email orders update (does NOT auto-advance - user clicks Continue)
  const handleEmailOrdersUpdate = useCallback((orders: ExtractedOrder[]) => {
    setEmailOrders(orders);
    // Don't auto-advance - user will click Continue when ready
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
    setTipsOpenForStep(null);
    setCurrentStep('integrations');
  }, []);

  // Go to previous step
  const goBack = useCallback(() => {
    if (currentStepIndex > 0) {
      setTipsOpenForStep(null);
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

  const renderFooterNavigation = () => {
    const handleSkip = () => {
      if (currentStep === 'welcome') {
        handleSkipEmailSync();
        return;
      }

      if (currentStep === 'csv') {
        const skip = csvFooterState.onSkip === noop
          ? () => handleCSVComplete([])
          : csvFooterState.onSkip;
        skip();
        return;
      }

      if (currentStep === 'masterlist') {
        setTipsOpenForStep(null);
        onSkip();
        return;
      }

      handleStepComplete(currentStep);
    };

    const handleContinue = () => {
      if (currentStep === 'welcome') {
        handleStartEmailSync();
        return;
      }

      if (currentStep === 'csv') {
        csvFooterState.onContinue();
        return;
      }

      if (currentStep === 'masterlist') {
        masterListFooterState.onComplete();
        return;
      }

      goForward();
    };

    const continueDisabled = currentStep === 'welcome'
      ? false
      : currentStep === 'csv'
        ? !csvFooterState.canContinue
        : currentStep === 'masterlist'
          ? !masterListFooterState.canComplete
          : !canGoForward;

    return (
      <div
        className="fixed bottom-0 inset-x-0 z-40 border-t border-arda-border/70 bg-white/75 backdrop-blur"
        role="navigation"
        aria-label="Onboarding navigation"
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={goBack}
            disabled={!canGoBack}
            className="btn-arda-outline flex items-center gap-2 disabled:opacity-50"
          >
            <Icons.ChevronLeft className="w-4 h-4" />
            Back
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSkip}
              className="btn-arda-outline"
            >
              Skip
            </button>

            {currentStep === 'masterlist' && (
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
            )}

            <button
              type="button"
              onClick={handleContinue}
              disabled={continueDisabled}
              title={currentStep === 'email'
                ? 'Continuing won’t stop email scanning. Import keeps running in the background.'
                : undefined}
              className={[
                'flex items-center gap-2 px-4 py-2 rounded-arda font-semibold text-sm transition-colors',
                !continueDisabled
                  ? 'bg-arda-accent text-white hover:bg-arda-accent-hover'
                  : 'bg-arda-border text-arda-text-muted cursor-not-allowed',
              ].join(' ')}
            >
              Continue
              <Icons.ChevronRight className="w-4 h-4" />
            </button>

            {currentStep === 'email' && (
              <span className="sr-only">
                Continuing won’t stop email scanning. Import keeps running in the background.
              </span>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderStepIndicator = () => (
    <div className="sticky top-0 z-40 border-b border-arda-border/70 bg-white/75 backdrop-blur relative">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-orange-500 to-orange-600 shadow-arda flex items-center justify-center flex-shrink-0">
            <Icons.Package className="w-4 h-4 text-white" />
          </div>
          <span className="text-sm font-semibold text-arda-text-primary flex-shrink-0">Arda</span>
          <div className="min-w-0 flex items-center gap-2">
            <span className="text-[11px] text-arda-text-muted flex-shrink-0">
              Step {currentStepIndex + 1} of {ONBOARDING_STEPS.length}
            </span>
            <span className="text-sm font-semibold text-arda-text-primary truncate">
              {currentStepConfig.title}
            </span>
            <span className="hidden md:block text-xs text-arda-text-secondary truncate">
              {currentStepConfig.description}
            </span>
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
                      if (isInteractive) {
                        setTipsOpenForStep(null);
                        setCurrentStep(step.id);
                      }
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

        <div className="flex items-center gap-2 flex-shrink-0">
          <div ref={tipsWrapperRef} className="relative">
	            <button
	              type="button"
	              onClick={() => setTipsOpenForStep(open => (open === currentStep ? null : currentStep))}
	              className="btn-arda-outline text-sm py-1.5 flex items-center gap-2"
	              aria-expanded={tipsOpen}
	              aria-controls={`onboarding-tips-${currentStep}`}
	              aria-haspopup="dialog"
	            >
	              <Icons.Lightbulb className="w-4 h-4" />
	              <span className="sr-only sm:not-sr-only">Tips</span>
	            </button>

            {tipsOpen && (
              <div
	                id={`onboarding-tips-${currentStep}`}
	                role="dialog"
	                aria-label={currentStepConfig.tipsTitle}
	                className="absolute right-0 top-full mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-arda-border bg-white/95 backdrop-blur shadow-lg p-3 z-50"
	              >
                <div className="text-[11px] font-semibold text-arda-text-muted uppercase tracking-wide">
                  {currentStepConfig.tipsTitle}
                </div>
                <ul className="mt-2 text-xs text-arda-text-secondary space-y-1 list-disc list-inside">
                  {currentStepConfig.tips.map((tip, index) => (
                    <li key={`${currentStep}-${index}`}>{tip}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

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

      <div className="absolute inset-x-0 bottom-0 h-1 bg-arda-bg-tertiary overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-orange-400 to-orange-500 transition-all duration-300"
          style={{ width: `${((currentStepIndex + 1) / ONBOARDING_STEPS.length) * 100}%` }}
          role="progressbar"
          aria-label="Onboarding progress"
          aria-valuenow={currentStepIndex + 1}
          aria-valuemin={1}
          aria-valuemax={ONBOARDING_STEPS.length}
        />
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
            onCanProceed={handleCanProceedFromEmail}
            onStateChange={handleEmailScanStateChange}
            initialState={emailScanState}
            embedded
          />
        ) : (
          <div className="space-y-4">
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
        <div className="space-y-3">
          {urlReviewBlockMessage && (
            <div className="rounded-xl border border-orange-200 bg-orange-50 text-orange-900 text-xs px-3 py-2">
              {urlReviewBlockMessage}
            </div>
          )}
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
        </div>
      )}
      
      {currentStep === 'photo' && (
        <PhotoCaptureStep
          sessionId={mobileSessionId}
          capturedPhotos={capturedPhotos}
          onPhotoCaptured={handlePhotoCaptured}
          onComplete={() => handleStepComplete('photo')}
          onBack={() => {
            setTipsOpenForStep(null);
            setCurrentStep('url');
          }}
        />
      )}

      {currentStep === 'csv' && (
        <CSVUploadStep
          onComplete={handleCSVComplete}
          onBack={() => {
            setTipsOpenForStep(null);
            setCurrentStep('photo');
          }}
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
          onBack={() => {
            setTipsOpenForStep(null);
            setCurrentStep('csv');
          }}
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
            <div className="flex-1 min-w-0 lg:sticky lg:top-14 lg:self-start lg:max-h-[calc(100vh-10rem)] overflow-hidden rounded-xl border border-arda-border bg-white shadow-sm">
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

      {renderFooterNavigation()}
    </div>
  );
};
