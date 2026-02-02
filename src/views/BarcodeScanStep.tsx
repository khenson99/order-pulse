import { useState, useEffect, useRef, useCallback } from 'react';
import { Icons } from '../components/Icons';
import { ScannedBarcode } from './OnboardingFlow';

interface BarcodeScanStepProps {
  sessionId: string;
  scannedBarcodes: ScannedBarcode[];
  onBarcodeScanned: (barcode: ScannedBarcode) => void;
  onComplete: () => void;
  onBack: () => void;
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
  onComplete,
  onBack,
}) => {
  const [scannerInput, setScannerInput] = useState('');
  const [isListening, setIsListening] = useState(true);
  const [recentScan, setRecentScan] = useState<string | null>(null);
  const [lookupStatus, setLookupStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const inputRef = useRef<HTMLInputElement>(null);
  const scanTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        const response = await fetch(`/api/scan/session/${sessionId}/barcodes`);
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
      } catch (error) {
        // Silently ignore polling errors
      }
    }, 2000);

    return () => clearInterval(pollInterval);
  }, [sessionId, scannedBarcodes, onBarcodeScanned]);

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
        processBarcode(value);
      }
    }, 100);
  }, []);

  // Process a scanned barcode
  const processBarcode = async (barcode: string) => {
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
      id: `scan-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
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
  };

  // Detect barcode type from string
  const detectBarcodeType = (barcode: string): ScannedBarcode['barcodeType'] => {
    const digits = barcode.replace(/\D/g, '');
    if (digits.length === 12) return 'UPC-A';
    if (digits.length === 13) return 'EAN-13';
    if (digits.length === 8) return 'UPC';
    return 'unknown';
  };

  // Look up product info from barcode (placeholder - would call real API)
  const lookupBarcode = async (barcode: string): Promise<{
    name: string;
    brand?: string;
    imageUrl?: string;
    category?: string;
  } | null> => {
    try {
      const response = await fetch(`/api/barcode/lookup?code=${encodeURIComponent(barcode)}`);
      if (response.ok) {
        return await response.json();
      }
    } catch {
      // Ignore lookup errors
    }
    return null;
  };

  // Handle keyboard input
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (scannerInput.length >= 8) {
        processBarcode(scannerInput);
      }
    }
  };

  // Generate QR code as data URL
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(getMobileScanUrl(sessionId))}`;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Scan Barcodes</h1>
          <p className="text-gray-500 mt-1">
            Scan UPC or EAN codes using a barcode scanner or your phone's camera
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="px-4 py-2 text-gray-600 hover:text-gray-900 transition-colors"
          >
            ← Back
          </button>
          <button
            onClick={onComplete}
            className="px-6 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
          >
            Continue
            <Icons.ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Scanning options */}
      <div className="grid grid-cols-2 gap-6">
        {/* Desktop scanner */}
        <div className="bg-white rounded-xl border-2 border-gray-200 p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
              <Icons.Barcode className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Barcode Scanner</h3>
              <p className="text-sm text-gray-500">Use a USB or Bluetooth scanner</p>
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
              className={`
                w-full px-4 py-3 border-2 rounded-lg text-lg font-mono
                ${isListening ? 'border-blue-300 bg-blue-50' : 'border-gray-200'}
                focus:outline-none focus:border-blue-500
              `}
              onFocus={() => setIsListening(true)}
              onBlur={() => setTimeout(() => setIsListening(false), 200)}
            />
            {isListening && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse" />
              </div>
            )}
          </div>

          {/* Recent scan feedback */}
          {recentScan && (
            <div className={`
              flex items-center gap-2 px-3 py-2 rounded-lg text-sm
              ${lookupStatus === 'loading' ? 'bg-yellow-50 text-yellow-700' : ''}
              ${lookupStatus === 'success' ? 'bg-green-50 text-green-700' : ''}
              ${lookupStatus === 'error' ? 'bg-red-50 text-red-700' : ''}
              ${lookupStatus === 'idle' ? 'bg-gray-50 text-gray-700' : ''}
            `}>
              {lookupStatus === 'loading' && <Icons.Loader2 className="w-4 h-4 animate-spin" />}
              {lookupStatus === 'success' && <Icons.CheckCircle2 className="w-4 h-4" />}
              {lookupStatus === 'error' && <Icons.AlertCircle className="w-4 h-4" />}
              <span className="font-mono">{recentScan}</span>
            </div>
          )}

          <p className="text-xs text-gray-400">
            Click the input field and scan. The scanner sends keystrokes like a keyboard.
          </p>
        </div>

        {/* Mobile scanner QR */}
        <div className="bg-white rounded-xl border-2 border-gray-200 p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center">
              <Icons.Smartphone className="w-6 h-6 text-purple-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Phone Camera</h3>
              <p className="text-sm text-gray-500">Scan the QR code with your phone</p>
            </div>
          </div>

          {/* QR Code */}
          <div className="flex flex-col items-center gap-3">
            <div className="bg-white p-3 rounded-lg border border-gray-200">
              <img 
                src={qrCodeUrl} 
                alt="Scan to open mobile scanner"
                className="w-40 h-40"
              />
            </div>
            <p className="text-sm text-gray-500 text-center">
              Scan this QR code to open the mobile scanner.<br />
              Barcodes will sync to this screen in real-time.
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs text-gray-400">
            <Icons.Link className="w-3 h-3" />
            <span className="font-mono truncate">{getMobileScanUrl(sessionId)}</span>
          </div>
        </div>
      </div>

      {/* Scanned items list */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">
            Scanned Items ({scannedBarcodes.length})
          </h3>
          {scannedBarcodes.length > 0 && (
            <span className="text-sm text-gray-500">
              {scannedBarcodes.filter(b => b.productName).length} identified
            </span>
          )}
        </div>

        {scannedBarcodes.length === 0 ? (
          <div className="px-6 py-12 text-center text-gray-400">
            <Icons.Barcode className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>No barcodes scanned yet</p>
            <p className="text-sm mt-1">Scan a UPC or EAN code to get started</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 max-h-80 overflow-auto">
            {scannedBarcodes.map((item) => (
              <div key={item.id} className="px-6 py-3 flex items-center gap-4 hover:bg-gray-50">
                {/* Image or placeholder */}
                <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center overflow-hidden flex-shrink-0">
                  {item.imageUrl ? (
                    <img src={item.imageUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <Icons.Package className="w-6 h-6 text-gray-400" />
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 truncate">
                    {item.productName || 'Unknown Product'}
                  </p>
                  <div className="flex items-center gap-3 text-sm text-gray-500">
                    <span className="font-mono">{item.barcode}</span>
                    <span className="px-1.5 py-0.5 bg-gray-100 rounded text-xs">
                      {item.barcodeType}
                    </span>
                    {item.brand && <span>{item.brand}</span>}
                  </div>
                </div>

                {/* Source badge */}
                <div className={`
                  px-2 py-1 rounded text-xs font-medium
                  ${item.source === 'mobile' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}
                `}>
                  {item.source === 'mobile' ? '📱 Mobile' : '🖥️ Desktop'}
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
      <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
        <div className="flex items-start gap-3">
          <Icons.Lightbulb className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-amber-800">
            <p className="font-medium mb-1">Tips for scanning</p>
            <ul className="list-disc list-inside space-y-0.5 text-amber-700">
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
