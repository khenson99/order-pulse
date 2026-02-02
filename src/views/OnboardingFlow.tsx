import { useState, useCallback } from 'react';
import { Icons } from '../components/Icons';
import { ExtractedOrder, InventoryItem } from '../types';
import { SupplierSetup } from './SupplierSetup';
import { BarcodeScanStep } from './BarcodeScanStep';
import { PhotoCaptureStep } from './PhotoCaptureStep';
import { CSVReconcileStep } from './CSVReconcileStep';

// Onboarding step definitions
export type OnboardingStep = 'email' | 'barcode' | 'photo' | 'reconcile';

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
    id: 'reconcile',
    number: 4,
    title: 'Review & Push',
    description: 'Dedupe, reconcile, and sync to Arda',
    icon: 'CheckCircle2',
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
  matchedToEmailItem?: string; // ID of matched email item
}

// Captured item photo
export interface CapturedPhoto {
  id: string;
  imageData: string; // Base64 or URL
  capturedAt: string;
  source: 'desktop' | 'mobile';
  // Extracted data from image analysis
  extractedText?: string[];
  detectedBarcodes?: string[];
  suggestedName?: string;
  suggestedSupplier?: string;
  isInternalItem?: boolean; // vs externally procured
}

// Unified item for reconciliation
export interface ReconciliationItem {
  id: string;
  source: 'email' | 'barcode' | 'photo' | 'csv';
  // Core fields
  name: string;
  normalizedName?: string;
  supplier?: string;
  location?: string;
  // Identifiers
  barcode?: string;
  sku?: string;
  asin?: string;
  // Quantities
  quantity?: number;
  minQty?: number;
  orderQty?: number;
  // Pricing
  unitPrice?: number;
  // Media
  imageUrl?: string;
  productUrl?: string;
  // Matching
  duplicateOf?: string; // ID of item this is a duplicate of
  isDuplicate?: boolean;
  matchConfidence?: number;
  // Status
  isApproved?: boolean;
  isExcluded?: boolean;
  needsReview?: boolean;
}

interface OnboardingFlowProps {
  onComplete: (items: ReconciliationItem[]) => void;
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
  onSkip: _onSkip,
  userProfile: _userProfile,
}) => {
  const [currentStep, setCurrentStep] = useState<OnboardingStep>('email');
  const [completedSteps, setCompletedSteps] = useState<Set<OnboardingStep>>(new Set());
  
  // Data from each step
  const [, setEmailOrders] = useState<ExtractedOrder[]>([]);
  const [emailInventory, setEmailInventory] = useState<InventoryItem[]>([]);
  const [scannedBarcodes, setScannedBarcodes] = useState<ScannedBarcode[]>([]);
  const [capturedPhotos, setCapturedPhotos] = useState<CapturedPhoto[]>([]);
  const [, setReconciliationItems] = useState<ReconciliationItem[]>([]);
  
  // Note: _onSkip and _userProfile are available for future use
  
  // Background email scanning progress
  const [emailProgress, setEmailProgress] = useState<BackgroundEmailProgress | null>(null);
  
  // Mobile session ID for syncing
  const [mobileSessionId] = useState(() => 
    `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
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

  // Handle email step completion
  const handleEmailComplete = useCallback((orders: ExtractedOrder[]) => {
    setEmailOrders(orders);
    handleStepComplete('email');
  }, [handleStepComplete]);

  // Handle barcode scan
  const handleBarcodeScanned = useCallback((barcode: ScannedBarcode) => {
    setScannedBarcodes(prev => {
      // Avoid duplicates
      if (prev.some(b => b.barcode === barcode.barcode)) {
        return prev;
      }
      return [...prev, barcode];
    });
  }, []);

  // Handle photo capture
  const handlePhotoCaptured = useCallback((photo: CapturedPhoto) => {
    setCapturedPhotos(prev => [...prev, photo]);
  }, []);

  // Handle final reconciliation complete
  const handleReconcileComplete = useCallback((items: ReconciliationItem[]) => {
    setReconciliationItems(items);
    handleStepComplete('reconcile');
    onComplete(items);
  }, [handleStepComplete, onComplete]);

  // Update email progress from child component
  const handleEmailProgressUpdate = useCallback((progress: BackgroundEmailProgress | null) => {
    setEmailProgress(progress);
  }, []);

  // Get step status
  const getStepStatus = (stepId: OnboardingStep): 'completed' | 'current' | 'upcoming' => {
    if (completedSteps.has(stepId)) return 'completed';
    if (currentStep === stepId) return 'current';
    return 'upcoming';
  };

  // Render step indicator
  const renderStepIndicator = () => (
    <div className="bg-white border-b border-gray-200 px-6 py-4">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between">
          {ONBOARDING_STEPS.map((step, index) => {
            const status = getStepStatus(step.id);
            const Icon = Icons[step.icon] || Icons.Circle;
            
            return (
              <div key={step.id} className="flex items-center">
                {/* Step circle */}
                <button
                  onClick={() => {
                    // Allow navigation to completed steps or current step
                    if (status === 'completed' || status === 'current') {
                      setCurrentStep(step.id);
                    }
                  }}
                  disabled={status === 'upcoming'}
                  className={`
                    flex items-center gap-3 p-2 rounded-lg transition-all
                    ${status === 'current' ? 'bg-blue-50' : ''}
                    ${status === 'completed' ? 'cursor-pointer hover:bg-gray-50' : ''}
                    ${status === 'upcoming' ? 'opacity-50 cursor-not-allowed' : ''}
                  `}
                >
                  <div className={`
                    w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm
                    ${status === 'completed' ? 'bg-green-500 text-white' : ''}
                    ${status === 'current' ? 'bg-blue-500 text-white' : ''}
                    ${status === 'upcoming' ? 'bg-gray-200 text-gray-500' : ''}
                  `}>
                    {status === 'completed' ? (
                      <Icons.Check className="w-5 h-5" />
                    ) : (
                      <Icon className="w-5 h-5" />
                    )}
                  </div>
                  <div className="text-left">
                    <p className={`text-sm font-medium ${
                      status === 'current' ? 'text-blue-600' : 
                      status === 'completed' ? 'text-green-600' : 'text-gray-500'
                    }`}>
                      {step.title}
                    </p>
                    <p className="text-xs text-gray-400">{step.description}</p>
                  </div>
                </button>
                
                {/* Connector line */}
                {index < ONBOARDING_STEPS.length - 1 && (
                  <div className={`
                    h-0.5 w-12 mx-2
                    ${completedSteps.has(step.id) ? 'bg-green-300' : 'bg-gray-200'}
                  `} />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  // Render background progress bar
  const renderBackgroundProgress = () => {
    if (!emailProgress?.isActive) return null;
    
    const percent = emailProgress.total > 0 
      ? Math.round((emailProgress.processed / emailProgress.total) * 100) 
      : 0;
    
    return (
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-6 py-3 shadow-lg z-50">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-4">
            <Icons.Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
            <div className="flex-1">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm text-gray-600">
                  {emailProgress.currentTask || `Scanning ${emailProgress.supplier}...`}
                </span>
                <span className="text-sm font-medium text-blue-600">{percent}%</span>
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-blue-500 transition-all duration-300"
                  style={{ width: `${percent}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Render current step content
  const renderStepContent = () => {
    switch (currentStep) {
      case 'email':
        return (
          <SupplierSetup
            onScanComplete={handleEmailComplete}
            onSkip={() => handleStepComplete('email')}
            onProgressUpdate={handleEmailProgressUpdate}
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
      
      case 'reconcile':
        return (
          <CSVReconcileStep
            emailItems={emailInventory}
            scannedBarcodes={scannedBarcodes}
            capturedPhotos={capturedPhotos}
            onComplete={handleReconcileComplete}
            onBack={() => setCurrentStep('photo')}
          />
        );
      
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Step indicator at top */}
      {renderStepIndicator()}
      
      {/* Main content area */}
      <div className="flex-1 overflow-auto pb-20">
        <div className="max-w-4xl mx-auto p-6">
          {renderStepContent()}
        </div>
      </div>
      
      {/* Background email progress at bottom */}
      {currentStep !== 'email' && renderBackgroundProgress()}
    </div>
  );
};
