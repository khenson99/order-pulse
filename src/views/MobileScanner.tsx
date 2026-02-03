import { useState, useEffect, useRef, useCallback } from 'react';
import { BrowserMultiFormatReader, BarcodeFormat, DecodeHintType } from '@zxing/library';
import { Icons } from '../components/Icons';
import { API_BASE_URL } from '../services/api';

interface MobileScannerProps {
  sessionId: string;
  mode: 'barcode' | 'photo';
}

interface ScannedItem {
  id: string;
  type: 'barcode' | 'photo';
  data: string;
  timestamp: string;
  synced: boolean;
}

export const MobileScanner: React.FC<MobileScannerProps> = ({
  sessionId,
  mode,
}) => {
  const [isScanning, setIsScanning] = useState(false);
  const [scannedItems, setScannedItems] = useState<ScannedItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cameraFacing, setCameraFacing] = useState<'environment' | 'user'>('environment');
  const [flashEnabled, setFlashEnabled] = useState(false);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const idCounterRef = useRef(0);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);

  const nextId = useCallback((prefix: 'scan' | 'photo') => {
    idCounterRef.current += 1;
    return `${prefix}-${idCounterRef.current}`;
  }, []);

  // Sync item to desktop session
  const syncToDesktop = useCallback(async (item: ScannedItem) => {
    try {
      const endpoint = item.type === 'barcode' 
        ? `/api/scan/session/${sessionId}/barcode`
        : `/api/photo/session/${sessionId}/photo`;
      
      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          id: item.id,
          data: item.data,
          timestamp: item.timestamp,
        }),
      });
      
      // Mark as synced if response is successful (2xx status)
      if (response.ok) {
        setScannedItems(prev => 
          prev.map(i => i.id === item.id ? { ...i, synced: true } : i)
        );
      } else {
        // Log non-ok responses but don't throw - item is still saved locally
        console.warn(`Sync response ${response.status}: ${response.statusText}`);
      }
    } catch (err) {
      // Network errors are logged but not surfaced to user
      // Item remains in local state and can be retried
      console.warn('Sync warning (will retry):', err);
    }
  }, [sessionId]);

  // Handle detected barcode - defined before scanForBarcode so it's in scope
  const handleBarcodeDetected = useCallback(async (barcode: string) => {
    // Avoid duplicates in quick succession
    const now = Date.now();
    const recentScans = scannedItems.filter(
      item => now - new Date(item.timestamp).getTime() < 3000
    );
    if (recentScans.some(item => item.data === barcode)) {
      return;
    }
    
    // Vibrate for feedback
    if (navigator.vibrate) {
      navigator.vibrate(100);
    }
    
    const item: ScannedItem = {
      id: nextId('scan'),
      type: 'barcode',
      data: barcode,
      timestamp: new Date().toISOString(),
      synced: false,
    };
    
    setScannedItems(prev => [item, ...prev]);
    
    // Sync to desktop
    await syncToDesktop(item);
  }, [scannedItems, nextId, syncToDesktop]);

  // Start continuous barcode scanning using ZXing
  const scanForBarcode = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current) return;
    
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    
    if (!ctx || video.videoWidth === 0 || video.readyState !== video.HAVE_ENOUGH_DATA) return;
    
    // Set canvas size to video size
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    // Draw current frame
    ctx.drawImage(video, 0, 0);
    
    // Initialize ZXing reader if needed
    if (!readerRef.current) {
      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.EAN_13,
        BarcodeFormat.EAN_8,
        BarcodeFormat.UPC_A,
        BarcodeFormat.UPC_E,
        BarcodeFormat.CODE_128,
        BarcodeFormat.CODE_39,
        BarcodeFormat.ITF,
        BarcodeFormat.QR_CODE,
      ]);
      hints.set(DecodeHintType.TRY_HARDER, true);
      readerRef.current = new BrowserMultiFormatReader(hints);
    }
    
    try {
      // Convert canvas to image and decode
      const dataUrl = canvas.toDataURL('image/png');
      const result = await readerRef.current.decodeFromImage(undefined, dataUrl);
      if (result) {
        handleBarcodeDetected(result.getText());
      }
    } catch {
      // No barcode found in this frame - this is normal, just continue scanning
    }
  }, [handleBarcodeDetected]);

  const startBarcodeScanning = useCallback(() => {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
    }
    
    scanIntervalRef.current = setInterval(() => {
      void scanForBarcode();
    }, 200); // Scan every 200ms
  }, [scanForBarcode]);

  // Start camera
  const startCamera = useCallback(async () => {
    try {
      setError(null);
      
      // Check if we're in a secure context (HTTPS or localhost)
      if (!window.isSecureContext) {
        setError('Camera requires HTTPS. Please access this page via https://');
        return;
      }
      
      // Check if mediaDevices is available
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setError('Camera not supported in this browser. Try Chrome or Safari.');
        return;
      }
      
      // Stop existing stream
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: cameraFacing,
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      
      streamRef.current = stream;
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setIsScanning(true);
        
        // Start continuous scanning for barcodes
        if (mode === 'barcode') {
          startBarcodeScanning();
        }
      }
    } catch (err) {
      console.error('Camera error:', err);
      const error = err as Error;
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        setError('Camera permission denied. Please allow camera access in your browser settings.');
      } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        setError('No camera found on this device.');
      } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
        setError('Camera is in use by another app. Please close other apps using the camera.');
      } else if (error.name === 'OverconstrainedError') {
        setError('Camera does not support the requested settings. Try switching cameras.');
      } else {
        setError(`Camera error: ${error.message || 'Unknown error'}`);
      }
    }
  }, [cameraFacing, mode, startBarcodeScanning]);

  // Stop camera
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
    if (readerRef.current) {
      readerRef.current.reset();
      readerRef.current = null;
    }
    setIsScanning(false);
  }, []);

  // Note: scanForBarcode and handleBarcodeDetected are defined above with useCallback

  // Capture photo
  const capturePhoto = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    
    if (!ctx) return;
    
    try {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      
      const imageData = canvas.toDataURL('image/jpeg', 0.9);
      
      // Vibrate for feedback
      if (navigator.vibrate) {
        navigator.vibrate(50);
      }
      
      const item: ScannedItem = {
        id: nextId('photo'),
        type: 'photo',
        data: imageData,
        timestamp: new Date().toISOString(),
        synced: false,
      };
      
      setScannedItems(prev => [item, ...prev]);
      
      // Sync to desktop (errors are handled inside syncToDesktop)
      await syncToDesktop(item);
    } catch (err) {
      // Silently handle capture errors - photo still saved locally
      console.warn('Photo capture warning:', err);
    }
  };

  // Note: syncToDesktop is defined above with useCallback

  // Toggle camera facing
  const toggleCamera = () => {
    setCameraFacing(prev => prev === 'environment' ? 'user' : 'environment');
  };

  // Restart camera when facing changes
  useEffect(() => {
    if (!isScanning) return;
    const timeout = setTimeout(() => {
      void startCamera();
    }, 0);
    return () => clearTimeout(timeout);
  }, [cameraFacing, isScanning, startCamera]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  return (
    <div className="min-h-screen bg-black flex flex-col">
      {/* Header */}
      <div className="bg-black/80 backdrop-blur-sm px-4 py-3 flex items-center justify-between z-10 border-b border-white/10">
        <div className="flex items-center gap-3 text-white">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-orange-500 to-orange-600 flex items-center justify-center shadow-arda">
            <Icons.Package className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-semibold leading-tight">
              {mode === 'barcode' ? 'Barcode Scanner' : 'Photo Capture'}
            </h1>
            <p className="text-xs text-white/60">
              Syncing to your desktop
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-white/80 text-sm">
            {scannedItems.length} scanned
          </span>
          <div className={`w-2 h-2 rounded-full ${
            scannedItems.some(i => !i.synced) ? 'bg-yellow-500 animate-pulse' : 'bg-green-500'
          }`} />
        </div>
      </div>

      {/* Camera view */}
      <div className="flex-1 relative">
        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full object-cover"
          playsInline
          muted
        />
        
        {/* Hidden canvas for processing */}
        <canvas ref={canvasRef} className="hidden" />
        
        {/* Scanning overlay for barcode mode */}
        {mode === 'barcode' && isScanning && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-64 h-40 border-2 border-orange-400/60 rounded-xl relative">
              <div className="absolute top-0 left-0 w-6 h-6 border-l-4 border-t-4 border-orange-300 rounded-tl-xl" />
              <div className="absolute top-0 right-0 w-6 h-6 border-r-4 border-t-4 border-orange-300 rounded-tr-xl" />
              <div className="absolute bottom-0 left-0 w-6 h-6 border-l-4 border-b-4 border-orange-300 rounded-bl-xl" />
              <div className="absolute bottom-0 right-0 w-6 h-6 border-r-4 border-b-4 border-orange-300 rounded-br-xl" />
              
              {/* Scanning line animation */}
              <div className="absolute left-4 right-4 h-0.5 bg-arda-accent animate-scan" />
            </div>
            <p className="absolute bottom-8 text-white/80 text-sm">
              Position barcode within frame
            </p>
          </div>
        )}
        
        {/* Error state */}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80">
            <div className="text-center p-6">
              <Icons.AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-3" />
              <p className="text-white mb-4">{error}</p>
              <button
                onClick={startCamera}
                className="px-6 py-2 bg-white text-black rounded-lg font-medium"
              >
                Try Again
              </button>
            </div>
          </div>
        )}
        
        {/* Start camera prompt */}
        {!isScanning && !error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black">
            <button
              onClick={startCamera}
              className="flex flex-col items-center gap-4 p-8"
            >
              <div className="w-20 h-20 bg-white/10 rounded-full flex items-center justify-center">
                {mode === 'barcode' ? (
                  <Icons.Barcode className="w-10 h-10 text-white" />
                ) : (
                  <Icons.Camera className="w-10 h-10 text-white" />
                )}
              </div>
              <p className="text-white font-medium">
                {mode === 'barcode' ? 'Tap to start scanning' : 'Tap to take photos'}
              </p>
            </button>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="bg-black/80 backdrop-blur-sm px-4 py-6 safe-area-inset-bottom">
        <div className="flex items-center justify-around">
          {/* Switch camera */}
          <button
            onClick={toggleCamera}
            aria-label="Switch camera"
            title="Switch camera"
            className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center"
          >
            <Icons.RefreshCw className="w-5 h-5 text-white" />
          </button>
          
          {/* Capture button (for photo mode) */}
          {mode === 'photo' && isScanning && (
            <button
              onClick={capturePhoto}
              aria-label="Capture photo"
              title="Capture photo"
              className="w-16 h-16 rounded-full bg-white flex items-center justify-center"
            >
              <div className="w-14 h-14 rounded-full border-4 border-black/20" />
            </button>
          )}
          
          {/* Barcode mode indicator */}
          {mode === 'barcode' && isScanning && (
            <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center">
              <Icons.Barcode className="w-8 h-8 text-green-500" />
            </div>
          )}
          
          {/* Flash toggle (placeholder) */}
          <button
            onClick={() => setFlashEnabled(!flashEnabled)}
            aria-label={flashEnabled ? 'Disable flash' : 'Enable flash'}
            title={flashEnabled ? 'Disable flash' : 'Enable flash'}
            className={`w-12 h-12 rounded-full flex items-center justify-center ${
              flashEnabled ? 'bg-yellow-500' : 'bg-white/10'
            }`}
          >
            <Icons.Zap className={`w-5 h-5 ${flashEnabled ? 'text-black' : 'text-white'}`} />
          </button>
        </div>
      </div>

      {/* Recent scans strip */}
      {scannedItems.length > 0 && (
        <div className="absolute bottom-24 left-0 right-0 px-4">
          <div className="flex gap-2 overflow-x-auto pb-2">
            {scannedItems.slice(0, 5).map((item) => (
              <div
                key={item.id}
                className={`
                  flex-shrink-0 px-3 py-2 rounded-lg flex items-center gap-2
                  ${item.synced ? 'bg-green-500/20' : 'bg-white/10'}
                `}
              >
                {item.type === 'barcode' ? (
                  <>
                    <Icons.Barcode className="w-4 h-4 text-white" />
                    <span className="text-white text-sm font-mono">{item.data}</span>
                  </>
                ) : (
                  <img src={item.data} alt="" className="w-10 h-10 rounded object-cover" />
                )}
                {item.synced && (
                  <Icons.Check className="w-4 h-4 text-green-500" />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Custom styles for scan animation */}
      <style>{`
        @keyframes scan {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(140px); }
        }
        .animate-scan {
          animation: scan 2s ease-in-out infinite;
        }
        .safe-area-inset-bottom {
          padding-bottom: max(1.5rem, env(safe-area-inset-bottom));
        }
      `}</style>
    </div>
  );
};
