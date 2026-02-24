import { useState, useEffect, useRef, useCallback } from 'react';
import { Icons } from '../components/Icons';
import { ScannedBarcode } from './OnboardingFlow';
import { API_BASE_URL } from '../services/api';

interface BarcodeScanStepProps {
  sessionId: string;
  scannedBarcodes: ScannedBarcode[];
  onBarcodeScanned: (barcode: ScannedBarcode) => void;
  onComplete?: () => void;
  onBack?: () => void;
}

const BARCODE_TYPES: ScannedBarcode['barcodeType'][] = ['UPC-A', 'EAN-13', 'EAN-8', 'GTIN-14', 'UPC', 'EAN', 'unknown'];

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
  type EditableBarcodeField = 'productName' | 'barcode' | 'barcodeType' | 'brand' | 'category';

  const [scannerInput, setScannerInput] = useState('');
  const [isListening, setIsListening] = useState(true);
  const [recentScan, setRecentScan] = useState<string | null>(null);
  const [lookupStatus, setLookupStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [savingBarcodeId, setSavingBarcodeId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const scanTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idCounterRef = useRef(0);
  const scannedBarcodesRef = useRef<ScannedBarcode[]>(scannedBarcodes);
  const dirtyFieldsByBarcodeIdRef = useRef<Map<string, Set<EditableBarcodeField>>>(new Map());
  const savingBarcodeIdRef = useRef<string | null>(null);

  useEffect(() => {
    scannedBarcodesRef.current = scannedBarcodes;
  }, [scannedBarcodes]);

  useEffect(() => {
    savingBarcodeIdRef.current = savingBarcodeId;
  }, [savingBarcodeId]);

  const markBarcodeDirty = useCallback((barcodeId: string, field: EditableBarcodeField) => {
    const current = dirtyFieldsByBarcodeIdRef.current.get(barcodeId);
    if (current) {
      current.add(field);
      return;
    }
    dirtyFieldsByBarcodeIdRef.current.set(barcodeId, new Set([field]));
  }, []);

  const clearBarcodeDirty = useCallback((barcodeId: string) => {
    dirtyFieldsByBarcodeIdRef.current.delete(barcodeId);
  }, []);

  const nextId = useCallback(() => {
    idCounterRef.current += 1;
    return `scan-${idCounterRef.current}`;
  }, []);

  const saveSessionBarcode = useCallback(async (item: ScannedBarcode): Promise<ScannedBarcode | null> => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/scan/session/${sessionId}/barcode`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: item.id,
          data: item.barcode,
          timestamp: item.scannedAt,
          barcodeType: item.barcodeType,
          source: item.source,
          productName: item.productName,
          brand: item.brand,
          imageUrl: item.imageUrl,
          category: item.category,
        }),
      });
      if (!response.ok) return null;
      const data = await response.json();
      if (data?.barcode) return data.barcode as ScannedBarcode;
    } catch {
      // Keep UI responsive even if session persistence fails temporarily.
    }
    return null;
  }, [sessionId]);

  const persistBarcodeById = useCallback(async (barcodeId: string, override?: ScannedBarcode): Promise<void> => {
    const item = override || scannedBarcodesRef.current.find((entry) => entry.id === barcodeId);
    if (!item) return;

    const dirtyFields = dirtyFieldsByBarcodeIdRef.current.get(item.id);
    if (!dirtyFields || dirtyFields.size === 0) return;

    setSavingBarcodeId(item.id);
    try {
      const payload: Record<string, unknown> = {};

      if (dirtyFields.has('barcode')) payload.barcode = item.barcode;
      if (dirtyFields.has('barcodeType')) payload.barcodeType = item.barcodeType;
      if (dirtyFields.has('productName')) payload.productName = item.productName ?? '';
      if (dirtyFields.has('brand')) payload.brand = item.brand ?? '';
      if (dirtyFields.has('category')) payload.category = item.category ?? '';

      const response = await fetch(`${API_BASE_URL}/api/scan/session/${sessionId}/barcode/${encodeURIComponent(item.id)}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) return;
      const data = await response.json();
      if (data?.barcode) {
        const saved = data.barcode as ScannedBarcode;
        clearBarcodeDirty(item.id);
        clearBarcodeDirty(saved.id);
        onBarcodeScanned(saved);
      }
    } catch {
      // Ignore update failures; user edits remain in local onboarding state.
    } finally {
      setSavingBarcodeId((current) => (current === item.id ? null : current));
    }
  }, [clearBarcodeDirty, onBarcodeScanned, sessionId]);

  // Focus input for scanner when listening
  useEffect(() => {
    if (isListening && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isListening]);

  // Poll for session barcodes so desktop/mobile stay in sync.
  useEffect(() => {
    const syncBarcodes = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/scan/session/${sessionId}/barcodes`, {
          credentials: 'include',
        });
        if (!response.ok) return;
        const data = await response.json();
        if (!data.barcodes || !Array.isArray(data.barcodes)) return;
        const localBarcodes = scannedBarcodesRef.current;
        const currentlySavingId = savingBarcodeIdRef.current;

        data.barcodes.forEach((barcode: ScannedBarcode) => {
          const localMatch = localBarcodes.find((entry) => entry.id === barcode.id)
            || localBarcodes.find((entry) => entry.barcode === barcode.barcode);
          if (localMatch) {
            if (localMatch.id === currentlySavingId) return;
            const dirtyFields = dirtyFieldsByBarcodeIdRef.current.get(localMatch.id);
            if (dirtyFields && dirtyFields.size > 0) return;
          }
          onBarcodeScanned(barcode);
        });
      } catch {
        // Silently ignore polling errors.
      }
    };

    void syncBarcodes();
    const pollInterval = setInterval(() => {
      void syncBarcodes();
    }, 2000);

    return () => clearInterval(pollInterval);
  }, [sessionId, onBarcodeScanned]);

  // Detect barcode type from string
  const detectBarcodeType = useCallback((barcode: string): ScannedBarcode['barcodeType'] => {
    const digits = barcode.replace(/\D/g, '');
    if (digits.length === 12) return 'UPC-A';
    if (digits.length === 13) return 'EAN-13';
    if (digits.length === 8) return 'EAN-8';
    if (digits.length === 14) return 'GTIN-14';
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

    // Check for duplicates by code
    if (scannedBarcodes.some((entry) => entry.barcode === cleanBarcode)) {
      setRecentScan(`${cleanBarcode} (already scanned)`);
      setScannerInput('');
      return;
    }

    setLookupStatus('loading');
    setRecentScan(cleanBarcode);

    const scannedItem: ScannedBarcode = {
      id: nextId(),
      barcode: cleanBarcode,
      barcodeType: detectBarcodeType(cleanBarcode),
      scannedAt: new Date().toISOString(),
      source: 'desktop',
    };

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

    const persisted = await saveSessionBarcode(scannedItem);
    onBarcodeScanned(persisted || scannedItem);
    setScannerInput('');

    // Clear status after a delay
    setTimeout(() => {
      setLookupStatus('idle');
      setRecentScan(null);
    }, 2000);
  }, [detectBarcodeType, lookupBarcode, nextId, onBarcodeScanned, saveSessionBarcode, scannedBarcodes]);

  // Handle scanner input
  const handleScannerInput = useCallback((value: string) => {
    setScannerInput(value);

    if (scanTimeoutRef.current) {
      clearTimeout(scanTimeoutRef.current);
    }

    scanTimeoutRef.current = setTimeout(() => {
      if (value.length >= 8) {
        void processBarcode(value);
      }
    }, 100);
  }, [processBarcode]);

  const handleEditableItemChange = useCallback((
    item: ScannedBarcode,
    field: EditableBarcodeField,
    value: string,
  ) => {
    markBarcodeDirty(item.id, field);
    const next: ScannedBarcode = {
      ...item,
      [field]: value || undefined,
    };

    if (field === 'barcode') {
      next.barcode = value;
    }
    if (field === 'barcodeType') {
      next.barcodeType = (value as ScannedBarcode['barcodeType']) || 'unknown';
    }

    onBarcodeScanned(next);
  }, [markBarcodeDirty, onBarcodeScanned]);

  // Handle keyboard input
  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (scannerInput.length >= 8) {
        void processBarcode(scannerInput);
      }
    }
  };

  // Generate QR code as data URL
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(getMobileScanUrl(sessionId))}`;

  return (
    <div className="space-y-4">
      <div className="card-arda p-4 sm:p-5">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-4 items-stretch">
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 bg-orange-50 rounded-2xl flex items-center justify-center border border-orange-100">
                <Icons.Barcode className="w-5 h-5 text-arda-accent" />
              </div>
              <div>
                <h3 className="font-semibold text-arda-text-primary">Barcode scanner</h3>
                <p className="text-sm text-arda-text-secondary">Use a USB or Bluetooth scanner</p>
              </div>
            </div>

            <div className="relative">
              <input
                ref={inputRef}
                type="text"
                value={scannerInput}
                onChange={(event) => handleScannerInput(event.target.value)}
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
              Keep focus in the input while scanning. Each row below is fully editable.
            </p>
          </div>

          <div className="space-y-3 lg:border-l lg:border-arda-border lg:pl-4">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 bg-arda-bg-tertiary rounded-2xl flex items-center justify-center border border-arda-border">
                <Icons.Smartphone className="w-5 h-5 text-arda-text-secondary" />
              </div>
              <div>
                <h3 className="font-semibold text-arda-text-primary">Phone camera</h3>
                <p className="text-sm text-arda-text-secondary">Scan QR to open the mobile scanner</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="bg-white p-2 rounded-xl border border-arda-border shadow-arda flex-shrink-0">
                <img
                  src={qrCodeUrl}
                  alt="Scan to open mobile scanner"
                  className="w-28 h-28 sm:w-32 sm:h-32"
                />
              </div>
              <p className="text-sm text-arda-text-secondary">
                Barcodes scanned on your phone sync here in real-time.
              </p>
            </div>

            <div className="flex items-center gap-2 text-xs text-arda-text-muted bg-white/70 border border-arda-border rounded-xl px-3 py-2">
              <Icons.Link className="w-3 h-3" />
              <span className="font-mono truncate">{getMobileScanUrl(sessionId)}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="card-arda overflow-hidden">
        <div className="px-6 py-4 border-b border-arda-border bg-arda-bg-secondary flex items-center justify-between">
          <h3 className="font-semibold text-arda-text-primary">
            Scanned Items ({scannedBarcodes.length})
          </h3>
          {scannedBarcodes.length > 0 && (
            <span className="text-sm text-arda-text-secondary">
              {scannedBarcodes.filter((barcode) => barcode.productName).length} identified
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
          <div className="divide-y divide-arda-border max-h-[52vh] overflow-auto">
            {scannedBarcodes.map((item) => (
              <div key={item.id} className="px-4 py-3 hover:bg-arda-bg-tertiary transition-colors">
                <div className="flex items-start gap-3">
                  <div className="w-12 h-12 bg-arda-bg-tertiary rounded-xl flex items-center justify-center overflow-hidden flex-shrink-0 border border-arda-border">
                    {item.imageUrl ? (
                      <img src={item.imageUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <Icons.Package className="w-6 h-6 text-arda-text-muted" />
                    )}
                  </div>

                  <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-2">
                    <label className="text-xs text-arda-text-secondary">
                      Name
                      <input
                        type="text"
                        value={item.productName || ''}
                        onChange={(event) => handleEditableItemChange(item, 'productName', event.target.value)}
                        onBlur={() => void persistBarcodeById(item.id)}
                        className="mt-1 w-full px-2 py-1 text-sm border border-arda-border rounded bg-white"
                        placeholder="Product name"
                      />
                    </label>

                    <label className="text-xs text-arda-text-secondary">
                      Barcode
                      <input
                        type="text"
                        value={item.barcode}
                        onChange={(event) => handleEditableItemChange(item, 'barcode', event.target.value)}
                        onBlur={() => void persistBarcodeById(item.id)}
                        className="mt-1 w-full px-2 py-1 text-sm border border-arda-border rounded bg-white font-mono"
                        placeholder="Barcode"
                      />
                    </label>

                    <label className="text-xs text-arda-text-secondary">
                      Type
                      <select
                        value={item.barcodeType}
                        onChange={(event) => {
                          const nextType = event.target.value as ScannedBarcode['barcodeType'];
                          handleEditableItemChange(item, 'barcodeType', nextType);
                          void persistBarcodeById(item.id, { ...item, barcodeType: nextType });
                        }}
                        className="mt-1 w-full px-2 py-1 text-sm border border-arda-border rounded bg-white"
                      >
                        {BARCODE_TYPES.map((type) => (
                          <option key={type} value={type}>{type}</option>
                        ))}
                      </select>
                    </label>

                    <label className="text-xs text-arda-text-secondary">
                      Brand
                      <input
                        type="text"
                        value={item.brand || ''}
                        onChange={(event) => handleEditableItemChange(item, 'brand', event.target.value)}
                        onBlur={() => void persistBarcodeById(item.id)}
                        className="mt-1 w-full px-2 py-1 text-sm border border-arda-border rounded bg-white"
                        placeholder="Brand"
                      />
                    </label>

                    <label className="text-xs text-arda-text-secondary">
                      Category
                      <input
                        type="text"
                        value={item.category || ''}
                        onChange={(event) => handleEditableItemChange(item, 'category', event.target.value)}
                        onBlur={() => void persistBarcodeById(item.id)}
                        className="mt-1 w-full px-2 py-1 text-sm border border-arda-border rounded bg-white"
                        placeholder="Category"
                      />
                    </label>
                  </div>

                  <div className="w-24 text-right text-xs text-arda-text-muted space-y-1">
                    <div className="px-2 py-1 rounded-lg font-medium bg-arda-bg-tertiary border border-arda-border text-arda-text-secondary inline-block">
                      {item.source === 'mobile' ? 'Mobile' : 'Desktop'}
                    </div>
                    <div>{new Date(item.scannedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                    {savingBarcodeId === item.id && (
                      <div className="inline-flex items-center gap-1 text-arda-accent">
                        <Icons.Loader2 className="w-3 h-3 animate-spin" />
                        <span>Saving</span>
                      </div>
                    )}
                    {item.matchedToEmailItem && (
                      <div className="inline-flex items-center gap-1 text-green-600">
                        <Icons.Link className="w-3 h-3" />
                        <span>Matched</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

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
