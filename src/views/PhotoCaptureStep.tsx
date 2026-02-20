import { useState, useEffect, useRef, useCallback } from 'react';
import { Icons } from '../components/Icons';
import { InstructionCard } from '../components/InstructionCard';
import { CapturedPhoto } from './OnboardingFlow';
import { API_BASE_URL } from '../services/api';

interface PhotoCaptureStepProps {
  sessionId: string;
  capturedPhotos: CapturedPhoto[];
  onPhotoCaptured: (photo: CapturedPhoto) => void;
  onComplete?: () => void;
  onBack?: () => void;
}

// Generate QR code URL for mobile photo capture page
const getMobilePhotoUrl = (sessionId: string): string => {
  const baseUrl = window.location.origin;
  return `${baseUrl}/photo/${sessionId}`;
};

export const PhotoCaptureStep: React.FC<PhotoCaptureStepProps> = ({
  sessionId,
  capturedPhotos,
  onPhotoCaptured,
}) => {
  const [isAnalyzing, setIsAnalyzing] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const photoIdCounterRef = useRef(0);

  const nextPhotoId = useCallback(() => {
    photoIdCounterRef.current += 1;
    return `photo-${photoIdCounterRef.current}`;
  }, []);

  // Analyze image using Gemini
  const analyzeImage = useCallback(async (imageData: string): Promise<{
    extractedText?: string[];
    detectedBarcodes?: string[];
    suggestedName?: string;
    suggestedSupplier?: string;
    isInternalItem?: boolean;
  }> => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/photo/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ imageData }),
      });
      
      if (response.ok) {
        return await response.json();
      }
    } catch {
      // Ignore analysis errors
    }
    return {};
  }, []);

  // Trigger analysis for a photo and update it
  const analyzeAndUpdatePhoto = useCallback(async (photo: CapturedPhoto) => {
    if (!photo.imageData || photo.suggestedName) return; // Already analyzed or no data
    
    setIsAnalyzing(photo.id);
    try {
      const analysis = await analyzeImage(photo.imageData);
      if (analysis.suggestedName || analysis.extractedText?.length) {
        const updatedPhoto: CapturedPhoto = {
          ...photo,
          extractedText: analysis.extractedText,
          detectedBarcodes: analysis.detectedBarcodes,
          suggestedName: analysis.suggestedName,
          suggestedSupplier: analysis.suggestedSupplier,
          isInternalItem: analysis.isInternalItem,
        };
        onPhotoCaptured(updatedPhoto);
      }
    } catch {
      // Ignore analysis errors
    } finally {
      setIsAnalyzing(null);
    }
  }, [analyzeImage, onPhotoCaptured]);

  // Process uploaded file
  const processFile = useCallback(async (file: File) => {
    const reader = new FileReader();
    
    reader.onload = async (e) => {
      const imageData = e.target?.result as string;
      const photoId = nextPhotoId();
      
      // Create initial photo entry
      const photo: CapturedPhoto = {
        id: photoId,
        imageData,
        capturedAt: new Date().toISOString(),
        source: 'desktop',
      };
      
      onPhotoCaptured(photo);
      
      // Analyze the image
      setIsAnalyzing(photoId);
      try {
        const analysis = await analyzeImage(imageData);
        
        // Update photo with analysis results
        const updatedPhoto: CapturedPhoto = {
          ...photo,
          extractedText: analysis.extractedText,
          detectedBarcodes: analysis.detectedBarcodes,
          suggestedName: analysis.suggestedName,
          suggestedSupplier: analysis.suggestedSupplier,
          isInternalItem: analysis.isInternalItem,
        };
        
        onPhotoCaptured(updatedPhoto);
      } catch (error) {
        console.error('Failed to analyze image:', error);
      } finally {
        setIsAnalyzing(null);
      }
    };
    
    reader.readAsDataURL(file);
  }, [analyzeImage, nextPhotoId, onPhotoCaptured]);

  // Poll for mobile-captured photos
  useEffect(() => {
    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/photo/session/${sessionId}/photos`, {
          credentials: 'include',
        });
        if (response.ok) {
          const data = await response.json();
          if (data.photos && Array.isArray(data.photos)) {
            // Process each new photo
            for (const photoMeta of data.photos) {
              if (!capturedPhotos.some(existing => existing.id === photoMeta.id)) {
                // Fetch full image data for this photo
                try {
                  const imageResponse = await fetch(
                    `${API_BASE_URL}/api/photo/session/${sessionId}/photo/${photoMeta.id}`,
                    { credentials: 'include' }
                  );
                  if (imageResponse.ok) {
                    const { photo: fullPhoto } = await imageResponse.json();
                    const photo: CapturedPhoto = {
                      id: fullPhoto.id,
                      imageData: fullPhoto.imageData,
                      source: fullPhoto.source || 'mobile',
                      capturedAt: fullPhoto.capturedAt,
                      suggestedName: fullPhoto.suggestedName,
                      suggestedSupplier: fullPhoto.suggestedSupplier,
                      extractedText: fullPhoto.extractedText,
                      detectedBarcodes: fullPhoto.detectedBarcodes,
                      isInternalItem: fullPhoto.isInternalItem,
                    };
                    onPhotoCaptured(photo);
                    
                    // If not analyzed yet, trigger Gemini analysis
                    if (!photo.suggestedName && photo.imageData) {
                      analyzeAndUpdatePhoto(photo);
                    }
                  }
                } catch {
                  // Ignore individual photo fetch errors
                }
              }
            }
          }
        }
      } catch {
        // Silently ignore polling errors
      }
    }, 2000);

    return () => clearInterval(pollInterval);
  }, [sessionId, capturedPhotos, onPhotoCaptured, analyzeAndUpdatePhoto]);

  // Handle file drop
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    
    const files = Array.from(e.dataTransfer.files).filter(f => 
      f.type.startsWith('image/')
    );
    
    files.forEach(file => processFile(file));
  }, [processFile]);

  // Handle file selection
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    files.forEach(file => processFile(file));
    e.target.value = ''; // Reset for re-selection
  };

  // Get classification badge
  const getClassificationBadge = (photo: CapturedPhoto) => {
    if (photo.isInternalItem === true) {
      return (
        <span className="px-2 py-0.5 bg-orange-50 text-arda-accent border border-orange-100 rounded-lg text-xs font-medium">
          Internal
        </span>
      );
    }
    if (photo.isInternalItem === false) {
      return (
        <span className="px-2 py-0.5 bg-arda-bg-tertiary text-arda-text-secondary border border-arda-border rounded-lg text-xs font-medium">
          Purchased
        </span>
      );
    }
    return null;
  };

  // Generate QR code URL
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(getMobilePhotoUrl(sessionId))}`;

  return (
    <div className="space-y-6">
      <InstructionCard
        title="What to do"
        icon="Camera"
        steps={[
          'Upload photos or use the phone camera.',
          'Capture clear labels or packaging.',
          'Wait for AI extraction to finish.',
        ]}
      />

      {/* Capture options */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Desktop upload */}
        <div 
          className={`
            card-arda p-6 space-y-4 transition-colors cursor-pointer
            ${dragOver ? 'border-orange-300 bg-orange-50' : 'hover:border-arda-border-hover'}
          `}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-orange-50 rounded-2xl flex items-center justify-center border border-orange-100">
              <Icons.Upload className="w-6 h-6 text-arda-accent" />
            </div>
            <div>
              <h3 className="font-semibold text-arda-text-primary">Upload photos</h3>
              <p className="text-sm text-arda-text-secondary">Drag & drop or click to select</p>
            </div>
          </div>

          <div className="border-2 border-dashed border-arda-border rounded-2xl p-8 text-center bg-white/60">
            <Icons.Camera className="w-10 h-10 text-arda-text-muted mx-auto mb-3 opacity-60" />
            <p className="text-arda-text-secondary">
              Drop images here or <span className="text-arda-accent font-medium">browse</span>
            </p>
            <p className="text-xs text-arda-text-muted mt-1">
              Supports JPG, PNG, HEIC
            </p>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>

        {/* Mobile camera QR */}
        <div className="card-arda p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-arda-bg-tertiary rounded-2xl flex items-center justify-center border border-arda-border">
              <Icons.Smartphone className="w-6 h-6 text-arda-text-secondary" />
            </div>
            <div>
              <h3 className="font-semibold text-arda-text-primary">Phone camera</h3>
              <p className="text-sm text-arda-text-secondary">Capture photos and sync them here</p>
            </div>
          </div>

          {/* QR Code */}
          <div className="flex flex-col items-center gap-3">
            <div className="bg-white p-3 rounded-xl border border-arda-border shadow-arda">
              <img 
                src={qrCodeUrl} 
                alt="Scan to open mobile camera"
                className="w-40 h-40"
              />
            </div>
            <p className="text-sm text-arda-text-secondary text-center">
              Scan to open the mobile camera.<br />
              Photos will sync to this screen in real-time.
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs text-arda-text-muted bg-white/70 border border-arda-border rounded-xl px-3 py-2">
            <Icons.Link className="w-3 h-3" />
            <span className="font-mono truncate">{getMobilePhotoUrl(sessionId)}</span>
          </div>
        </div>
      </div>

      {/* Captured photos grid */}
      <div className="card-arda overflow-hidden">
        <div className="px-6 py-4 border-b border-arda-border bg-arda-bg-secondary flex items-center justify-between">
          <h3 className="font-semibold text-arda-text-primary">
            Captured Items ({capturedPhotos.length})
          </h3>
          {capturedPhotos.length > 0 && (
            <span className="text-sm text-arda-text-secondary">
              {capturedPhotos.filter(p => p.suggestedName).length} analyzed
            </span>
          )}
        </div>

        {capturedPhotos.length === 0 ? (
          <div className="px-6 py-12 text-center text-arda-text-muted">
            <Icons.Camera className="w-12 h-12 mx-auto mb-3 opacity-40" />
            <p>No photos captured yet</p>
            <p className="text-sm mt-1 text-arda-text-secondary">Upload or capture photos of items with labels</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 p-4">
            {capturedPhotos.map((photo) => (
              <div 
                key={photo.id} 
                className="relative bg-arda-bg-secondary rounded-2xl overflow-hidden border border-arda-border"
              >
                {/* Image */}
                <div className="aspect-square relative">
                  <img 
                    src={photo.imageData} 
                    alt={photo.suggestedName || 'Captured item'}
                    className="w-full h-full object-cover"
                  />
                  
                  {/* Analysis overlay */}
                  {isAnalyzing === photo.id && (
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                      <div className="text-white text-center">
                        <Icons.Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" />
                        <p className="text-sm">Analyzing...</p>
                      </div>
                    </div>
                  )}
                  
                  {/* Source badge */}
                  <div className="absolute top-2 right-2 px-2 py-1 rounded-lg text-xs font-medium bg-white/80 backdrop-blur border border-white/60 text-arda-text-secondary">
                    {photo.source === 'mobile' ? 'Mobile' : 'Desktop'}
                  </div>
                </div>

                {/* Info */}
                <div className="p-3 space-y-2">
                  <p className="font-medium text-arda-text-primary text-sm truncate">
                    {photo.suggestedName || 'Processing...'}
                  </p>
                  
                  <div className="flex items-center gap-2 flex-wrap">
                    {getClassificationBadge(photo)}
                    
                    {photo.suggestedSupplier && (
                      <span className="text-xs text-arda-text-secondary">
                        {photo.suggestedSupplier}
                      </span>
                    )}
                  </div>

                  {/* Detected barcodes */}
                  {photo.detectedBarcodes && photo.detectedBarcodes.length > 0 && (
                    <div className="flex items-center gap-1 text-xs text-green-600">
                      <Icons.Barcode className="w-3 h-3" />
                      <span>{photo.detectedBarcodes.length} barcode(s)</span>
                    </div>
                  )}

                  {/* Extracted text preview */}
                  {photo.extractedText && photo.extractedText.length > 0 && (
                    <div className="text-xs text-arda-text-muted truncate">
                      {photo.extractedText.slice(0, 3).join(', ')}
                    </div>
                  )}
                </div>
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
            <p className="font-medium text-arda-text-primary mb-1">Photo tips for best results</p>
            <ul className="list-disc list-inside space-y-0.5 text-arda-text-secondary">
              <li>Capture labels, packaging, or product markings clearly</li>
              <li>For internally-produced items, photo any part numbers or SKUs</li>
              <li>Good lighting helps with text extraction</li>
              <li>Multiple angles can help identify products</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};
