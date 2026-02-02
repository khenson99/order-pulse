import { useState, useCallback } from 'react';
import { Icons } from '../components/Icons';
import { ExtractedOrder } from '../types';
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
  
  // Check if can go back
  const canGoBack = currentStepIndex > 0;
  
  // Check if can go forward
  const canGoForward = currentStep === 'email' 
    ? canProceedFromEmail 
    : currentStep !== 'sync'; // Can always continue except on last step

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
    // Convert orders to simple email items for master list
    const items: EmailItem[] = orders.flatMap(order => 
      order.items.map(item => ({
        id: `email-${order.id}-${item.name}`,
        name: item.name,
        supplier: order.supplier,
        asin: item.asin,
        lastPrice: item.unitPrice,
        quantity: item.quantity,
        recommendedMin: Math.ceil((item.quantity || 1) / 2),
        recommendedOrderQty: item.quantity || 1,
      }))
    );
    setEmailItems(items);
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
    <div className="bg-white border-b border-gray-200 px-6 py-4">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between overflow-x-auto">
          {ONBOARDING_STEPS.map((step, index) => {
            const status = getStepStatus(step.id);
            const Icon = Icons[step.icon] || Icons.Circle;
            
            return (
              <div key={step.id} className="flex items-center">
                {/* Step circle */}
                <button
                  onClick={() => {
                    if (status === 'completed' || status === 'current') {
                      setCurrentStep(step.id);
                    }
                  }}
                  disabled={status === 'upcoming'}
                  className={`
                    flex items-center gap-2 p-2 rounded-lg transition-all whitespace-nowrap
                    ${status === 'current' ? 'bg-blue-50' : ''}
                    ${status === 'completed' ? 'cursor-pointer hover:bg-gray-50' : ''}
                    ${status === 'upcoming' ? 'opacity-50 cursor-not-allowed' : ''}
                  `}
                >
                  <div className={`
                    w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm
                    ${status === 'completed' ? 'bg-green-500 text-white' : ''}
                    ${status === 'current' ? 'bg-blue-500 text-white' : ''}
                    ${status === 'upcoming' ? 'bg-gray-200 text-gray-400' : ''}
                  `}>
                    {status === 'completed' ? (
                      <Icons.Check className="w-4 h-4" />
                    ) : (
                      <Icon className="w-4 h-4" />
                    )}
                  </div>
                  <div className="text-left hidden md:block">
                    <div className={`text-sm font-medium ${
                      status === 'upcoming' ? 'text-gray-400' : 'text-gray-900'
                    }`}>
                      {step.title}
                    </div>
                  </div>
                </button>
                
                {/* Connector line */}
                {index < ONBOARDING_STEPS.length - 1 && (
                  <div className={`
                    w-8 h-0.5 mx-1
                    ${completedSteps.has(step.id) ? 'bg-green-500' : 'bg-gray-200'}
                  `} />
                )}
              </div>
            );
          })}
        </div>
        
        {/* Background email progress indicator */}
        {emailProgress && emailProgress.isActive && currentStep !== 'email' && (
          <div className="mt-3 flex items-center gap-2 text-sm text-blue-600 bg-blue-50 rounded-lg px-3 py-2">
            <Icons.Loader2 className="w-4 h-4 animate-spin" />
            <span>
              Scanning emails in background: {emailProgress.supplier} 
              ({emailProgress.processed}/{emailProgress.total})
            </span>
          </div>
        )}
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
    <div className="sticky bottom-0 bg-white border-t border-gray-200 shadow-lg">
      <div className="max-w-6xl mx-auto px-6 py-4">
        <div className="flex items-center justify-between">
          {/* Left: Back button */}
          <div className="w-32">
            {canGoBack && (
              <button
                onClick={goBack}
                className="flex items-center gap-2 px-4 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <Icons.ChevronLeft className="w-5 h-5" />
                Back
              </button>
            )}
          </div>

          {/* Center: Progress info */}
          <div className="flex-1 flex flex-col items-center">
            {/* Step progress */}
            <div className="text-sm font-medium text-gray-700">
              Step {currentStepIndex + 1} of {ONBOARDING_STEPS.length}
            </div>
            
            {/* Item counts */}
            <div className="flex items-center gap-4 mt-1 text-xs text-gray-500">
              {emailItems.length > 0 && (
                <span className="flex items-center gap-1">
                  <Icons.Mail className="w-3 h-3" />
                  {emailItems.length} from email
                </span>
              )}
              {scannedBarcodes.length > 0 && (
                <span className="flex items-center gap-1">
                  <Icons.Barcode className="w-3 h-3" />
                  {scannedBarcodes.length} scanned
                </span>
              )}
              {capturedPhotos.filter(p => p.suggestedName).length > 0 && (
                <span className="flex items-center gap-1">
                  <Icons.Camera className="w-3 h-3" />
                  {capturedPhotos.filter(p => p.suggestedName).length} captured
                </span>
              )}
              {csvItems.length > 0 && (
                <span className="flex items-center gap-1">
                  <Icons.FileSpreadsheet className="w-3 h-3" />
                  {csvItems.length} from CSV
                </span>
              )}
              {totalItems > 0 && (
                <span className="font-medium text-gray-700">
                  ({totalItems} total items)
                </span>
              )}
            </div>

            {/* Email processing progress */}
            {emailProgress && emailProgress.isActive && (
              <div className="flex items-center gap-2 mt-2 text-xs text-blue-600 bg-blue-50 rounded-full px-3 py-1">
                <Icons.Loader2 className="w-3 h-3 animate-spin" />
                <span>
                  {emailProgress.supplier}: {emailProgress.processed}/{emailProgress.total}
                </span>
              </div>
            )}
          </div>

          {/* Right: Forward button */}
          <div className="w-32 flex justify-end">
            {currentStep !== 'sync' && (
              <button
                onClick={goForward}
                disabled={!canGoForward}
                className={`
                  flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors
                  ${canGoForward 
                    ? 'bg-blue-600 text-white hover:bg-blue-700' 
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'}
                `}
              >
                Continue
                <Icons.ChevronRight className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Step indicator */}
      {renderStepIndicator()}
      
      {/* Main content */}
      <div className="flex-1 p-6 pb-24">
        <div className="max-w-6xl mx-auto">
          {renderStepContent()}
        </div>
      </div>

      {/* Persistent footer */}
      {renderFooter()}
    </div>
  );
};
