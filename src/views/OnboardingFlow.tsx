import { useState, useCallback } from 'react';
import { Icons } from '../components/Icons';
import { ExtractedOrder } from '../types';
import { SupplierSetup } from './SupplierSetup';
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
    handleStepComplete('email');
  }, [handleStepComplete]);

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
            emailItems={emailInventory}
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

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Step indicator */}
      {renderStepIndicator()}
      
      {/* Main content */}
      <div className="flex-1 p-6">
        <div className="max-w-6xl mx-auto">
          {renderStepContent()}
        </div>
      </div>
    </div>
  );
};
