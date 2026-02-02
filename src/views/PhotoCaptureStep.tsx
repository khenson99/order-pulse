import { useState, useEffect, useRef, useCallback } from 'react';
import { Icons } from '../components/Icons';
import { CapturedPhoto } from './OnboardingFlow';
import { API_BASE_URL } from '../services/api';

interface PhotoCaptureStepProps {
  sessionId: string;
  capturedPhotos: CapturedPhoto[];
  onPhotoCaptured: (photo: CapturedPhoto) => void;
  onComplete: () => void;
  onBack: () => void;
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
  onComplete,
  onBack,
}) => {
  const [isAnalyzing, setIsAnalyzing] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
  }, [sessionId, capturedPhotos, onPhotoCaptured]);

  // Handle file drop
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    
    const files = Array.from(e.dataTransfer.files).filter(f => 
      f.type.startsWith('image/')
    );
    
    files.forEach(file => processFile(file));
  }, []);

  // Handle file selection
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    files.forEach(file => processFile(file));
    e.target.value = ''; // Reset for re-selection
  };

  // Process uploaded file
  const processFile = async (file: File) => {
    const reader = new FileReader();
    
    reader.onload = async (e) => {
      const imageData = e.target?.result as string;
      const photoId = `photo-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
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
  };

  // Analyze image using backend API
  const analyzeImage = async (imageData: string): Promise<{
    extractedText?: string[];
    detectedBarcodes?: string[];
    suggestedName?: string;
    suggestedSupplier?: string;
    isInternalItem?: boolean;
  }> => {
    try {
      const response = await fetch('/api/photo/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageData }),
      });
      
      if (response.ok) {
        return await response.json();
      }
    } catch {
      // Ignore analysis errors
    }
    return {};
  };

  // Get classification badge
  const getClassificationBadge = (photo: CapturedPhoto) => {
    if (photo.isInternalItem === true) {
      return (
        <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded text-xs font-medium">
          Internal
        </span>
      );
    }
    if (photo.isInternalItem === false) {
      return (
        <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-medium">
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
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Capture Item Photos</h1>
          <p className="text-gray-500 mt-1">
            Photograph items with labels to extract product information
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

      {/* Capture options */}
      <div className="grid grid-cols-2 gap-6">
        {/* Desktop upload */}
        <div 
          className={`
            bg-white rounded-xl border-2 p-6 space-y-4 transition-colors cursor-pointer
            ${dragOver ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}
          `}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
              <Icons.Upload className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Upload Photos</h3>
              <p className="text-sm text-gray-500">Drag & drop or click to select</p>
            </div>
          </div>

          <div className="border-2 border-dashed border-gray-200 rounded-lg p-8 text-center">
            <Icons.Camera className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500">
              Drop images here or <span className="text-blue-500">browse</span>
            </p>
            <p className="text-xs text-gray-400 mt-1">
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
        <div className="bg-white rounded-xl border-2 border-gray-200 p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center">
              <Icons.Smartphone className="w-6 h-6 text-purple-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Phone Camera</h3>
              <p className="text-sm text-gray-500">Take photos with your phone</p>
            </div>
          </div>

          {/* QR Code */}
          <div className="flex flex-col items-center gap-3">
            <div className="bg-white p-3 rounded-lg border border-gray-200">
              <img 
                src={qrCodeUrl} 
                alt="Scan to open mobile camera"
                className="w-40 h-40"
              />
            </div>
            <p className="text-sm text-gray-500 text-center">
              Scan to open the mobile camera.<br />
              Photos will sync to this screen in real-time.
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs text-gray-400">
            <Icons.Link className="w-3 h-3" />
            <span className="font-mono truncate">{getMobilePhotoUrl(sessionId)}</span>
          </div>
        </div>
      </div>

      {/* Captured photos grid */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">
            Captured Items ({capturedPhotos.length})
          </h3>
          {capturedPhotos.length > 0 && (
            <span className="text-sm text-gray-500">
              {capturedPhotos.filter(p => p.suggestedName).length} analyzed
            </span>
          )}
        </div>

        {capturedPhotos.length === 0 ? (
          <div className="px-6 py-12 text-center text-gray-400">
            <Icons.Camera className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>No photos captured yet</p>
            <p className="text-sm mt-1">Upload or capture photos of items with labels</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-4 p-4">
            {capturedPhotos.map((photo) => (
              <div 
                key={photo.id} 
                className="relative bg-gray-50 rounded-lg overflow-hidden border border-gray-200"
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
                  <div className={`
                    absolute top-2 right-2 px-2 py-0.5 rounded text-xs font-medium
                    ${photo.source === 'mobile' ? 'bg-purple-500 text-white' : 'bg-blue-500 text-white'}
                  `}>
                    {photo.source === 'mobile' ? '📱' : '🖥️'}
                  </div>
                </div>

                {/* Info */}
                <div className="p-3 space-y-2">
                  <p className="font-medium text-gray-900 text-sm truncate">
                    {photo.suggestedName || 'Processing...'}
                  </p>
                  
                  <div className="flex items-center gap-2 flex-wrap">
                    {getClassificationBadge(photo)}
                    
                    {photo.suggestedSupplier && (
                      <span className="text-xs text-gray-500">
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
                    <div className="text-xs text-gray-400 truncate">
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
      <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
        <div className="flex items-start gap-3">
          <Icons.Lightbulb className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-amber-800">
            <p className="font-medium mb-1">Photo tips for best results</p>
            <ul className="list-disc list-inside space-y-0.5 text-amber-700">
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
