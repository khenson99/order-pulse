import { useState, useEffect, useRef, useCallback } from 'react';
import { Icons } from '../components/Icons';
import { CapturedPhoto } from './OnboardingFlow';
import { API_BASE_URL } from '../services/api';

interface PhotoCaptureStepProps {
  sessionId: string;
  capturedPhotos: CapturedPhoto[];
  onPhotoCaptured: (photo: CapturedPhoto) => void;
  onComplete?: () => void;
  onBack?: () => void;
}

interface SessionPhotoMetadata {
  id: string;
  source: 'desktop' | 'mobile';
  capturedAt: string;
  suggestedName?: string;
  suggestedSupplier?: string;
  extractedText?: string[];
  detectedBarcodes?: string[];
  isInternalItem?: boolean;
  analyzed?: boolean;
}

type EditablePhotoMetadataField = 'suggestedName' | 'suggestedSupplier' | 'isInternalItem' | 'detectedBarcodes' | 'extractedText';

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
  const [dragOver, setDragOver] = useState(false);
  const [analyzingIds, setAnalyzingIds] = useState<Set<string>>(new Set());
  const [savingPhotoId, setSavingPhotoId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const photoIdCounterRef = useRef(0);
  const capturedPhotosRef = useRef<CapturedPhoto[]>(capturedPhotos);
  const dirtyFieldsByPhotoIdRef = useRef<Map<string, Set<EditablePhotoMetadataField>>>(new Map());
  const savingPhotoIdRef = useRef<string | null>(null);

  useEffect(() => {
    capturedPhotosRef.current = capturedPhotos;
  }, [capturedPhotos]);

  useEffect(() => {
    savingPhotoIdRef.current = savingPhotoId;
  }, [savingPhotoId]);

  const markPhotoDirty = useCallback((photoId: string, field: EditablePhotoMetadataField) => {
    const current = dirtyFieldsByPhotoIdRef.current.get(photoId);
    if (current) {
      current.add(field);
      return;
    }
    dirtyFieldsByPhotoIdRef.current.set(photoId, new Set([field]));
  }, []);

  const clearPhotoDirty = useCallback((photoId: string) => {
    dirtyFieldsByPhotoIdRef.current.delete(photoId);
  }, []);

  const nextPhotoId = useCallback(() => {
    photoIdCounterRef.current += 1;
    return `photo-${photoIdCounterRef.current}`;
  }, []);

  const markAnalyzing = useCallback((photoId: string, isAnalyzing: boolean) => {
    setAnalyzingIds((prev) => {
      const next = new Set(prev);
      if (isAnalyzing) next.add(photoId);
      else next.delete(photoId);
      return next;
    });
  }, []);

  const persistPhotoToSession = useCallback(async (photo: CapturedPhoto): Promise<void> => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/photo/session/${sessionId}/photo`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: photo.id,
          data: photo.imageData,
          timestamp: photo.capturedAt,
          source: photo.source,
        }),
      });
      if (!response.ok) {
        markAnalyzing(photo.id, false);
      }
    } catch {
      markAnalyzing(photo.id, false);
    }
  }, [markAnalyzing, sessionId]);

  const persistPhotoMetadata = useCallback(async (photoId: string, override?: CapturedPhoto): Promise<void> => {
    const photo = override || capturedPhotosRef.current.find((item) => item.id === photoId);
    if (!photo) return;

    const dirtyFields = dirtyFieldsByPhotoIdRef.current.get(photo.id);
    if (!dirtyFields || dirtyFields.size === 0) return;

    setSavingPhotoId(photo.id);
    try {
      const payload: Record<string, unknown> = {};

      if (dirtyFields.has('suggestedName')) payload.suggestedName = photo.suggestedName ?? '';
      if (dirtyFields.has('suggestedSupplier')) payload.suggestedSupplier = photo.suggestedSupplier ?? '';
      if (dirtyFields.has('isInternalItem')) payload.isInternalItem = photo.isInternalItem ?? null;
      if (dirtyFields.has('detectedBarcodes')) payload.detectedBarcodes = photo.detectedBarcodes ?? [];
      if (dirtyFields.has('extractedText')) payload.extractedText = photo.extractedText ?? [];

      const response = await fetch(`${API_BASE_URL}/api/photo/session/${sessionId}/photo/${encodeURIComponent(photo.id)}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) return;
      const data = await response.json();
      if (data?.photo) {
        clearPhotoDirty(photo.id);
        onPhotoCaptured({
          ...photo,
          ...data.photo,
        });
      }
    } catch {
      // Keep local edits even if save fails.
    } finally {
      setSavingPhotoId((current) => (current === photo.id ? null : current));
    }
  }, [clearPhotoDirty, onPhotoCaptured, sessionId]);

  // Process uploaded file
  const processFile = useCallback(async (file: File) => {
    const reader = new FileReader();

    reader.onload = async (event) => {
      const imageData = event.target?.result as string;
      const photoId = nextPhotoId();

      const photo: CapturedPhoto = {
        id: photoId,
        imageData,
        capturedAt: new Date().toISOString(),
        source: 'desktop',
      };

      onPhotoCaptured(photo);
      markAnalyzing(photoId, true);
      await persistPhotoToSession(photo);
    };

    reader.readAsDataURL(file);
  }, [markAnalyzing, nextPhotoId, onPhotoCaptured, persistPhotoToSession]);

  // Poll session photos and merge metadata updates.
  useEffect(() => {
    const syncPhotos = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/photo/session/${sessionId}/photos`, {
          credentials: 'include',
        });
        if (!response.ok) return;
        const data = await response.json();
        if (!data.photos || !Array.isArray(data.photos)) return;

        const localPhotos = capturedPhotosRef.current;
        const currentlySavingId = savingPhotoIdRef.current;

        for (const photoMeta of data.photos as SessionPhotoMetadata[]) {
          markAnalyzing(photoMeta.id, !photoMeta.analyzed);
          const existing = localPhotos.find((photo) => photo.id === photoMeta.id);

          if (existing) {
            const dirtyFields = dirtyFieldsByPhotoIdRef.current.get(photoMeta.id);
            if ((dirtyFields && dirtyFields.size > 0) || currentlySavingId === photoMeta.id) {
              continue;
            }

            const merged: CapturedPhoto = {
              ...existing,
              source: photoMeta.source ?? existing.source,
              capturedAt: photoMeta.capturedAt ?? existing.capturedAt,
              suggestedName: photoMeta.suggestedName ?? existing.suggestedName,
              suggestedSupplier: photoMeta.suggestedSupplier ?? existing.suggestedSupplier,
              extractedText: photoMeta.extractedText ?? existing.extractedText,
              detectedBarcodes: photoMeta.detectedBarcodes ?? existing.detectedBarcodes,
              isInternalItem: photoMeta.isInternalItem ?? existing.isInternalItem,
            };

            const changed = JSON.stringify(existing) !== JSON.stringify(merged);
            if (changed) {
              onPhotoCaptured(merged);
            }
            continue;
          }

          try {
            const imageResponse = await fetch(
              `${API_BASE_URL}/api/photo/session/${sessionId}/photo/${photoMeta.id}`,
              { credentials: 'include' },
            );
            if (!imageResponse.ok) continue;

            const { photo: fullPhoto } = await imageResponse.json();
            onPhotoCaptured({
              id: fullPhoto.id,
              imageData: fullPhoto.imageData,
              source: fullPhoto.source || 'mobile',
              capturedAt: fullPhoto.capturedAt,
              suggestedName: fullPhoto.suggestedName,
              suggestedSupplier: fullPhoto.suggestedSupplier,
              extractedText: fullPhoto.extractedText,
              detectedBarcodes: fullPhoto.detectedBarcodes,
              isInternalItem: fullPhoto.isInternalItem,
            });
          } catch {
            // Ignore individual photo fetch errors
          }
        }
      } catch {
        // Ignore polling errors
      }
    };

    void syncPhotos();
    const pollInterval = setInterval(() => {
      void syncPhotos();
    }, 2000);

    return () => clearInterval(pollInterval);
  }, [markAnalyzing, onPhotoCaptured, sessionId]);

  // Handle file drop
  const handleDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    setDragOver(false);

    const files = Array.from(event.dataTransfer.files).filter((file) =>
      file.type.startsWith('image/'),
    );

    files.forEach((file) => void processFile(file));
  }, [processFile]);

  // Handle file selection
  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    files.forEach((file) => void processFile(file));
    event.target.value = '';
  };

  const updatePhotoLocal = useCallback((photo: CapturedPhoto, updates: Partial<CapturedPhoto>) => {
    onPhotoCaptured({
      ...photo,
      ...updates,
    });
  }, [onPhotoCaptured]);

  // Generate QR code URL
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(getMobilePhotoUrl(sessionId))}`;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div
          className={`
            card-arda p-6 space-y-4 transition-colors cursor-pointer
            ${dragOver ? 'border-orange-300 bg-orange-50' : 'hover:border-arda-border-hover'}
          `}
          onDragOver={(event) => { event.preventDefault(); setDragOver(true); }}
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
            <p className="text-xs text-arda-text-muted mt-1">Supports JPG, PNG, HEIC</p>
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

      <div className="card-arda overflow-hidden">
        <div className="px-6 py-4 border-b border-arda-border bg-arda-bg-secondary flex items-center justify-between">
          <h3 className="font-semibold text-arda-text-primary">
            Captured Items ({capturedPhotos.length})
          </h3>
          {capturedPhotos.length > 0 && (
            <span className="text-sm text-arda-text-secondary">
              {capturedPhotos.filter((photo) => photo.suggestedName).length} analyzed
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
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 p-4">
            {capturedPhotos.map((photo) => (
              <div
                key={photo.id}
                className="relative bg-arda-bg-secondary rounded-2xl overflow-hidden border border-arda-border"
              >
                <div className="aspect-square relative">
                  <img
                    src={photo.imageData}
                    alt={photo.suggestedName || 'Captured item'}
                    className="w-full h-full object-cover"
                  />

                  {analyzingIds.has(photo.id) && (
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                      <div className="text-white text-center">
                        <Icons.Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" />
                        <p className="text-sm">Analyzing...</p>
                      </div>
                    </div>
                  )}

                  <div className="absolute top-2 left-2 px-2 py-1 rounded-lg text-xs font-medium bg-white/85 backdrop-blur border border-white/60 text-arda-text-secondary">
                    {photo.source === 'mobile' ? 'Mobile' : 'Desktop'}
                  </div>
                  <div className="absolute top-2 right-2 px-2 py-1 rounded-lg text-xs font-medium bg-white/85 backdrop-blur border border-white/60 text-arda-text-secondary">
                    {new Date(photo.capturedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>

                <div className="p-3 space-y-2">
                  <label className="text-xs text-arda-text-secondary block">
                    Item name
                    <input
                      type="text"
                      value={photo.suggestedName || ''}
                      onChange={(event) => {
                        markPhotoDirty(photo.id, 'suggestedName');
                        updatePhotoLocal(photo, { suggestedName: event.target.value || undefined });
                      }}
                      onBlur={() => void persistPhotoMetadata(photo.id)}
                      className="mt-1 w-full px-2 py-1 text-sm border border-arda-border rounded bg-white"
                      placeholder="Item name"
                    />
                  </label>

                  <label className="text-xs text-arda-text-secondary block">
                    Supplier / brand
                    <input
                      type="text"
                      value={photo.suggestedSupplier || ''}
                      onChange={(event) => {
                        markPhotoDirty(photo.id, 'suggestedSupplier');
                        updatePhotoLocal(photo, { suggestedSupplier: event.target.value || undefined });
                      }}
                      onBlur={() => void persistPhotoMetadata(photo.id)}
                      className="mt-1 w-full px-2 py-1 text-sm border border-arda-border rounded bg-white"
                      placeholder="Supplier"
                    />
                  </label>

                  <label className="text-xs text-arda-text-secondary block">
                    Classification
                    <select
                      value={
                        photo.isInternalItem === true
                          ? 'internal'
                          : photo.isInternalItem === false
                            ? 'purchased'
                            : 'unknown'
                      }
                      onChange={(event) => {
                        markPhotoDirty(photo.id, 'isInternalItem');
                        const nextValue = event.target.value === 'unknown'
                          ? undefined
                          : event.target.value === 'internal';
                        const updated = { ...photo, isInternalItem: nextValue };
                        updatePhotoLocal(photo, { isInternalItem: nextValue });
                        void persistPhotoMetadata(photo.id, updated);
                      }}
                      className="mt-1 w-full px-2 py-1 text-sm border border-arda-border rounded bg-white"
                    >
                      <option value="unknown">Unknown</option>
                      <option value="internal">Internal</option>
                      <option value="purchased">Purchased</option>
                    </select>
                  </label>

                  <label className="text-xs text-arda-text-secondary block">
                    Detected barcodes (comma separated)
                    <input
                      type="text"
                      value={photo.detectedBarcodes?.join(', ') || ''}
                      onChange={(event) => {
                        markPhotoDirty(photo.id, 'detectedBarcodes');
                        const next = event.target.value
                          .split(',')
                          .map((entry) => entry.trim())
                          .filter(Boolean);
                        updatePhotoLocal(photo, { detectedBarcodes: next.length > 0 ? next : undefined });
                      }}
                      onBlur={() => void persistPhotoMetadata(photo.id)}
                      className="mt-1 w-full px-2 py-1 text-sm border border-arda-border rounded bg-white font-mono"
                      placeholder="0123456789012, 998877665544"
                    />
                  </label>

                  <label className="text-xs text-arda-text-secondary block">
                    Extracted text (one line per item)
                    <textarea
                      value={photo.extractedText?.join('\n') || ''}
                      onChange={(event) => {
                        markPhotoDirty(photo.id, 'extractedText');
                        const lines = event.target.value
                          .split('\n')
                          .map((entry) => entry.trim())
                          .filter(Boolean);
                        updatePhotoLocal(photo, { extractedText: lines.length > 0 ? lines : undefined });
                      }}
                      onBlur={() => void persistPhotoMetadata(photo.id)}
                      rows={3}
                      className="mt-1 w-full px-2 py-1 text-sm border border-arda-border rounded bg-white"
                      placeholder={'Line 1\nLine 2'}
                    />
                  </label>

                  {savingPhotoId === photo.id && (
                    <div className="inline-flex items-center gap-1 text-xs text-arda-accent">
                      <Icons.Loader2 className="w-3 h-3 animate-spin" />
                      <span>Saving edits</span>
                    </div>
                  )}
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
