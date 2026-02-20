import { useState, useEffect, useRef, useCallback } from 'react';
import { Icons } from '../components/Icons';
import { InstructionCard } from '../components/InstructionCard';
import { ScannedBarcode } from './OnboardingFlow';
import { API_BASE_URL } from '../services/api';

interface BarcodeScanStepProps {
  sessionId: string;
  scannedBarcodes: ScannedBarcode[];
  onBarcodeScanned: (barcode: ScannedBarcode) => void;
  onComplete?: () => void;
  onBack?: () => void;
}

// Generate QR code URL for mobile scanning page
const getMobileScanUrl = (sessionId: string): string => {
  const baseUrl = window.location.origin;
  return `${baseUrl}/scan/${sessionId}`;
};

export const BarcodeScanStep: React.FC<BarcodeScanStepProps> = ({
  sessionId,
  scannedBarcodes,
  onBarcodeScanned,
}) => {
  const [scannerInput, setScannerInput] = useState('');
  const [isListening, setIsListening] = useState(true);
  const [recentScan, setRecentScan] = useState<string | null>(null);
  const [lookupStatus, setLookupStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const inputRef = useRef<HTMLInputElement>(null);
  const scanTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idCounterRef = useRef(0);

  const nextId = useCallback(() => {
    idCounterRef.current += 1;
    return `scan-${idCounterRef.current}`;
  }, []);

  // Focus input for scanner when listening
  useEffect(() => {
    if (isListening && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isListening]);

  // Poll for mobile-scanned barcodes (via API/websocket)
  useEffect(() => {
    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/scan/session/${sessionId}/barcodes`, {
          credentials: 'include',
        });
        if (response.ok) {
          const data = await response.json();
          // Process any new barcodes from mobile
          if (data.barcodes && Array.isArray(data.barcodes)) {
            data.barcodes.forEach((bc: ScannedBarcode) => {
              if (!scannedBarcodes.some(existing => existing.id === bc.id)) {
                onBarcodeScanned(bc);
              }
            });
          }
        }
      } catch {
        // Silently ignore polling errors
      }
    }, 2000);

    return () => clearInterval(pollInterval);
  }, [sessionId, scannedBarcodes, onBarcodeScanned]);

  // Detect barcode type from string
  const detectBarcodeType = useCallback((barcode: string): ScannedBarcode['barcodeType'] => {
    const digits = barcode.replace(/\D/g, '');
    if (digits.length === 12) return 'UPC-A';
    if (digits.length === 13) return 'EAN-13';
    if (digits.length === 8) return 'UPC';
    return 'unknown';
  }, []);

  // Look up product info from barcode
  const lookupBarcode = useCallback(async (barcode: string): Promise<{
    name: string;
    brand?: string;
    imageUrl?: string;
    category?: string;
  } | null> => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/barcode/lookup?code=${encodeURIComponent(barcode)}`, {
        credentials: 'include',
      });
      if (response.ok) {
        return await response.json();
      }
    } catch {
      // Ignore lookup errors
    }
    return null;
  }, []);

  // Process a scanned barcode
  const processBarcode = useCallback(async (barcode: string) => {
    const cleanBarcode = barcode.trim();
    if (!cleanBarcode) return;
    
    // Check for duplicates
    if (scannedBarcodes.some(b => b.barcode === cleanBarcode)) {
      setRecentScan(`${cleanBarcode} (already scanned)`);
      setScannerInput('');
      return;
    }
    
    setLookupStatus('loading');
    setRecentScan(cleanBarcode);
    
    // Determine barcode type
    const barcodeType = detectBarcodeType(cleanBarcode);
    
    // Create the scanned barcode entry
    const scannedItem: ScannedBarcode = {
      id: nextId(),
      barcode: cleanBarcode,
      barcodeType,
      scannedAt: new Date().toISOString(),
      source: 'desktop',
    };
    
    // Try to look up product info
    try {
      const productInfo = await lookupBarcode(cleanBarcode);
      if (productInfo) {
        scannedItem.productName = productInfo.name;
        scannedItem.brand = productInfo.brand;
        scannedItem.imageUrl = productInfo.imageUrl;
        scannedItem.category = productInfo.category;
      }
      setLookupStatus('success');
    } catch {
      setLookupStatus('error');
    }
    
    onBarcodeScanned(scannedItem);
    setScannerInput('');
    
    // Clear status after a delay
    setTimeout(() => {
      setLookupStatus('idle');
      setRecentScan(null);
    }, 2000);
  }, [detectBarcodeType, lookupBarcode, nextId, onBarcodeScanned, scannedBarcodes]);

  // Handle scanner input
  const handleScannerInput = useCallback((value: string) => {
    setScannerInput(value);
    
    // Clear previous timeout
    if (scanTimeoutRef.current) {
      clearTimeout(scanTimeoutRef.current);
    }
    
    // Barcode scanners typically send input quickly followed by Enter
    // Set a timeout to process if no more input comes
    scanTimeoutRef.current = setTimeout(() => {
      if (value.length >= 8) { // Minimum UPC length
        void processBarcode(value);
      }
    }, 100);
  }, [processBarcode]);

  // Handle keyboard input
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (scannerInput.length >= 8) {
        void processBarcode(scannerInput);
      }
    }
  };

  // Generate QR code as data URL
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(getMobileScanUrl(sessionId))}`;

  return (
    <div className="space-y-6">
      <InstructionCard
        title="What to do"
        icon="Barcode"
        steps={[
          'Scan with a USB/Bluetooth scanner or phone camera.',
          'Scan UPC/EAN codes on items.',
          'Confirm items appear below.',
        ]}
      />

      {/* Scanning options */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Desktop scanner */}
        <div className="card-arda p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-orange-50 rounded-2xl flex items-center justify-center border border-orange-100">
              <Icons.Barcode className="w-6 h-6 text-arda-accent" />
            </div>
            <div>
              <h3 className="font-semibold text-arda-text-primary">Barcode scanner</h3>
              <p className="text-sm text-arda-text-secondary">Use a USB or Bluetooth scanner</p>
            </div>
          </div>

          {/* Scanner input */}
          <div className="relative">
            <input
              ref={inputRef}
              type="text"
              value={scannerInput}
              onChange={(e) => handleScannerInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isListening ? 'Scan a barcode...' : 'Click to enable scanning'}
              className={[
                'input-arda font-mono text-lg',
                'pr-10',
                isListening ? 'bg-orange-50 ring-2 ring-arda-accent border-transparent' : '',
              ].join(' ')}
              onFocus={() => setIsListening(true)}
              onBlur={() => setTimeout(() => setIsListening(false), 200)}
            />
            {isListening && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <div className="w-3 h-3 bg-arda-accent rounded-full animate-pulse" />
              </div>
            )}
          </div>

          {/* Recent scan feedback */}
          {recentScan && (
            <div className={[
              'flex items-center gap-2 px-3 py-2 rounded-xl text-sm border',
              lookupStatus === 'loading' ? 'bg-orange-50 text-orange-700 border-orange-200' : '',
              lookupStatus === 'success' ? 'bg-green-50 text-green-700 border-green-200' : '',
              lookupStatus === 'error' ? 'bg-red-50 text-red-700 border-red-200' : '',
              lookupStatus === 'idle' ? 'bg-arda-bg-secondary text-arda-text-secondary border-arda-border' : '',
            ].join(' ')}>
              {lookupStatus === 'loading' && <Icons.Loader2 className="w-4 h-4 animate-spin" />}
              {lookupStatus === 'success' && <Icons.CheckCircle2 className="w-4 h-4" />}
              {lookupStatus === 'error' && <Icons.AlertCircle className="w-4 h-4" />}
              <span className="font-mono">{recentScan}</span>
            </div>
          )}

          <p className="text-xs text-arda-text-muted">
            Click the input field and scan. The scanner sends keystrokes like a keyboard.
          </p>
        </div>

        {/* Mobile scanner QR */}
        <div className="card-arda p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-arda-bg-tertiary rounded-2xl flex items-center justify-center border border-arda-border">
              <Icons.Smartphone className="w-6 h-6 text-arda-text-secondary" />
            </div>
            <div>
              <h3 className="font-semibold text-arda-text-primary">Phone camera</h3>
              <p className="text-sm text-arda-text-secondary">Scan the QR code to open the mobile scanner</p>
            </div>
          </div>

          {/* QR Code */}
          <div className="flex flex-col items-center gap-3">
            <div className="bg-white p-3 rounded-xl border border-arda-border shadow-arda">
              <img 
                src={qrCodeUrl} 
                alt="Scan to open mobile scanner"
                className="w-40 h-40"
              />
            </div>
            <p className="text-sm text-arda-text-secondary text-center">
              Scan this QR code to open the mobile scanner.<br />
              Barcodes will sync to this screen in real-time.
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs text-arda-text-muted bg-white/70 border border-arda-border rounded-xl px-3 py-2">
            <Icons.Link className="w-3 h-3" />
            <span className="font-mono truncate">{getMobileScanUrl(sessionId)}</span>
          </div>
        </div>
      </div>

      {/* Scanned items list */}
      <div className="card-arda overflow-hidden">
        <div className="px-6 py-4 border-b border-arda-border bg-arda-bg-secondary flex items-center justify-between">
          <h3 className="font-semibold text-arda-text-primary">
            Scanned Items ({scannedBarcodes.length})
          </h3>
          {scannedBarcodes.length > 0 && (
            <span className="text-sm text-arda-text-secondary">
              {scannedBarcodes.filter(b => b.productName).length} identified
            </span>
          )}
        </div>

        {scannedBarcodes.length === 0 ? (
          <div className="px-6 py-12 text-center text-arda-text-muted">
            <Icons.Barcode className="w-12 h-12 mx-auto mb-3 opacity-40" />
            <p>No barcodes scanned yet</p>
            <p className="text-sm mt-1 text-arda-text-secondary">Scan a UPC or EAN code to get started</p>
          </div>
        ) : (
          <div className="divide-y divide-arda-border max-h-80 overflow-auto">
            {scannedBarcodes.map((item) => (
              <div key={item.id} className="px-6 py-3 flex items-center gap-4 hover:bg-arda-bg-tertiary transition-colors">
                {/* Image or placeholder */}
                <div className="w-12 h-12 bg-arda-bg-tertiary rounded-xl flex items-center justify-center overflow-hidden flex-shrink-0 border border-arda-border">
                  {item.imageUrl ? (
                    <img src={item.imageUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <Icons.Package className="w-6 h-6 text-arda-text-muted" />
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-arda-text-primary truncate">
                    {item.productName || 'Unknown Product'}
                  </p>
                  <div className="flex items-center gap-3 text-sm text-arda-text-secondary">
                    <span className="font-mono text-arda-text-secondary">{item.barcode}</span>
                    <span className="px-2 py-0.5 bg-arda-bg-tertiary border border-arda-border rounded-lg text-xs text-arda-text-secondary">
                      {item.barcodeType}
                    </span>
                    {item.brand && <span>{item.brand}</span>}
                  </div>
                </div>

                {/* Source badge */}
                <div className="px-2.5 py-1 rounded-lg text-xs font-medium bg-arda-bg-tertiary border border-arda-border text-arda-text-secondary">
                  {item.source === 'mobile' ? 'Mobile' : 'Desktop'}
                </div>

                {/* Match status */}
                {item.matchedToEmailItem && (
                  <div className="flex items-center gap-1 text-green-600 text-sm">
                    <Icons.Link className="w-4 h-4" />
                    <span>Matched</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Tips */}
      <div className="bg-white/70 border border-arda-border rounded-arda-lg px-4 py-3">
        <div className="flex items-start gap-3">
          <Icons.Lightbulb className="w-5 h-5 text-arda-accent flex-shrink-0 mt-0.5" />
          <div className="text-sm text-arda-text-secondary">
            <p className="font-medium text-arda-text-primary mb-1">Tips for scanning</p>
            <ul className="list-disc list-inside space-y-0.5 text-arda-text-secondary">
              <li>US products typically have UPC-A (12 digits) or EAN-13 (13 digits)</li>
              <li>The mobile scanner supports continuous scanning - just point and scan</li>
              <li>Scanned items will automatically match to email orders when possible</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};
