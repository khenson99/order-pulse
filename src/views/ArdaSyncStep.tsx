import { useState, useCallback } from 'react';
import { Icons } from '../components/Icons';
import { MasterListItem } from './MasterListStep';
import { API_BASE_URL } from '../services/api';

interface SyncResult {
  itemId: string;
  itemName: string;
  success: boolean;
  ardaEntityId?: string;
  error?: string;
}

interface ArdaSyncStepProps {
  items: MasterListItem[];
  userEmail?: string;
  onComplete: () => void;
  onBack: () => void;
}

export const ArdaSyncStep: React.FC<ArdaSyncStepProps> = ({
  items,
  userEmail,
  onComplete,
  onBack,
}) => {
  // Sync state
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState({ current: 0, total: 0 });
  const [syncResults, setSyncResults] = useState<SyncResult[]>([]);
  const [syncComplete, setSyncComplete] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  // Verification state
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationResults, setVerificationResults] = useState<{
    found: number;
    missing: number;
    items: Array<{ id: string; name: string; found: boolean }>;
  } | null>(null);

  // Sync a single item to Arda
  const syncItemToArda = async (item: MasterListItem): Promise<SyncResult> => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/arda/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: item.name,
          sku: item.sku,
          barcode: item.barcode,
          supplier: item.supplier,
          location: item.location,
          minQty: item.minQty || 1,
          orderQty: item.orderQty || item.minQty || 1,
          unitPrice: item.unitPrice,
          imageUrl: item.imageUrl,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        return {
          itemId: item.id,
          itemName: item.name,
          success: false,
          error: errorData.error || 'Failed to create item',
        };
      }

      const data = await response.json();
      return {
        itemId: item.id,
        itemName: item.name,
        success: true,
        ardaEntityId: data.entityId || data.rId,
      };
    } catch (error) {
      return {
        itemId: item.id,
        itemName: item.name,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  };

  // Start sync process
  const startSync = useCallback(async () => {
    setIsSyncing(true);
    setSyncError(null);
    setSyncResults([]);
    setSyncProgress({ current: 0, total: items.length });

    const results: SyncResult[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      setSyncProgress({ current: i + 1, total: items.length });

      const result = await syncItemToArda(item);
      results.push(result);
      setSyncResults([...results]);

      // Small delay to avoid rate limiting
      if (i < items.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    setIsSyncing(false);
    setSyncComplete(true);
  }, [items]);

  // Verify items landed in Arda
  const verifyItems = useCallback(async () => {
    setIsVerifying(true);
    
    const successfulItems = syncResults.filter(r => r.success && r.ardaEntityId);
    const verificationItems: Array<{ id: string; name: string; found: boolean }> = [];
    let found = 0;
    let missing = 0;

    for (const item of successfulItems) {
      try {
        const response = await fetch(
          `${API_BASE_URL}/api/arda/items/${item.ardaEntityId}`,
          { credentials: 'include' }
        );
        
        const itemFound = response.ok;
        verificationItems.push({
          id: item.ardaEntityId!,
          name: item.itemName,
          found: itemFound,
        });
        
        if (itemFound) found++;
        else missing++;
      } catch {
        verificationItems.push({
          id: item.ardaEntityId!,
          name: item.itemName,
          found: false,
        });
        missing++;
      }
    }

    setVerificationResults({ found, missing, items: verificationItems });
    setIsVerifying(false);
  }, [syncResults]);

  // Open Arda in new tab
  const openArda = () => {
    window.open('https://app.arda.cards', '_blank');
  };

  // Stats
  const successCount = syncResults.filter(r => r.success).length;
  const failureCount = syncResults.filter(r => !r.success).length;

  return (
    <div className="space-y-6">
      {/* Pre-sync summary */}
      {!isSyncing && !syncComplete && (
        <div className="arda-glass rounded-2xl p-8 text-center">
          <div className="w-16 h-16 mx-auto bg-orange-50 border border-orange-100 rounded-2xl flex items-center justify-center mb-4">
            <Icons.Upload className="w-8 h-8 text-arda-accent" />
          </div>
          <h2 className="text-xl font-semibold text-arda-text-primary mb-2">
            Ready to Sync {items.length} Items
          </h2>
          <p className="text-arda-text-secondary mb-6 max-w-md mx-auto">
            We'll create these items in Arda's inventory system. 
            {userEmail && ` Items will be attributed to ${userEmail}.`}
          </p>

          {/* Preview of items */}
          <div className="bg-arda-bg-secondary border border-arda-border rounded-arda-lg p-4 mb-6 max-w-md mx-auto">
            <div className="text-sm text-arda-text-secondary mb-2">Items to sync:</div>
            <div className="flex flex-wrap gap-2 justify-center">
              {items.slice(0, 5).map(item => (
                <span 
                  key={item.id}
                  className="px-2 py-1 bg-white rounded-arda border border-arda-border text-sm text-arda-text-primary"
                >
                  {item.name}
                </span>
              ))}
              {items.length > 5 && (
                <span className="px-2 py-1 text-arda-text-muted text-sm">
                  +{items.length - 5} more
                </span>
              )}
            </div>
          </div>

          <button
            onClick={startSync}
            className="btn-arda-primary inline-flex items-center gap-2 px-8 py-3 rounded-xl"
          >
            <Icons.Zap className="w-5 h-5" />
            Start Sync to Arda
          </button>
        </div>
      )}

      {/* Sync in progress */}
      {isSyncing && (
        <div className="card-arda p-8">
          <div className="text-center mb-6">
            <Icons.Loader2 className="w-12 h-12 mx-auto text-arda-accent animate-spin mb-4" />
            <h2 className="text-xl font-semibold text-arda-text-primary mb-2">
              Syncing Items to Arda...
            </h2>
            <p className="text-arda-text-secondary">
              {syncProgress.current} of {syncProgress.total} items processed
            </p>
          </div>

          {/* Progress bar */}
          <div className="w-full bg-arda-bg-tertiary rounded-full h-3 mb-6 border border-arda-border">
            <div 
              className="bg-arda-accent h-3 rounded-full transition-all duration-300"
              style={{ width: `${(syncProgress.current / syncProgress.total) * 100}%` }}
            />
          </div>

          {/* Live results */}
          <div className="max-h-64 overflow-y-auto space-y-2">
            {syncResults.slice(-10).map(result => (
              <div 
                key={result.itemId}
                className={`
                  flex items-center gap-3 p-2 rounded-lg text-sm
                  ${result.success ? 'bg-green-50' : 'bg-red-50'}
                `}
              >
                {result.success ? (
                  <Icons.CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                ) : (
                  <Icons.XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                )}
                <span className="truncate">{result.itemName}</span>
                {result.error && (
                  <span className="text-red-600 text-xs ml-auto">{result.error}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sync complete */}
      {syncComplete && (
        <>
          {/* Summary */}
          <div className="grid grid-cols-3 gap-4">
            <div className="card-arda p-4 text-center">
              <div className="text-3xl font-bold text-arda-text-primary">{syncResults.length}</div>
              <div className="text-sm text-arda-text-secondary">Total Items</div>
            </div>
            <div className="bg-green-50 rounded-lg border border-green-200 p-4 text-center">
              <div className="text-3xl font-bold text-green-600">{successCount}</div>
              <div className="text-sm text-green-700">Successfully Synced</div>
            </div>
            <div className={`rounded-lg border p-4 text-center ${
              failureCount > 0 ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200'
            }`}>
              <div className={`text-3xl font-bold ${failureCount > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                {failureCount}
              </div>
              <div className={`text-sm ${failureCount > 0 ? 'text-red-700' : 'text-gray-500'}`}>
                Failed
              </div>
            </div>
          </div>

          {/* Results list */}
          <div className="card-arda overflow-hidden">
            <div className="px-6 py-4 border-b border-arda-border bg-arda-bg-secondary flex items-center justify-between">
              <h3 className="font-semibold text-arda-text-primary">Import Results</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={onComplete}
                  className="btn-arda-primary flex items-center gap-2"
                >
                  <Icons.Check className="w-4 h-4" />
                  Complete setup
                </button>
                {!verificationResults && successCount > 0 && (
                  <button
                    onClick={verifyItems}
                    disabled={isVerifying}
                    className="btn-arda-outline flex items-center gap-2 text-sm"
                  >
                    {isVerifying ? (
                      <>
                        <Icons.Loader2 className="w-4 h-4 animate-spin" />
                        Verifying...
                      </>
                    ) : (
                      <>
                        <Icons.Search className="w-4 h-4" />
                        Verify in Arda
                      </>
                    )}
                  </button>
                )}
                <button
                  onClick={openArda}
                  className="btn-arda-outline flex items-center gap-2 text-sm"
                >
                  <Icons.ExternalLink className="w-4 h-4" />
                  Open Arda
                </button>
              </div>
            </div>

            {/* Verification banner */}
            {verificationResults && (
              <div className={`px-6 py-3 flex items-center gap-3 ${
                verificationResults.missing === 0 ? 'bg-green-50' : 'bg-yellow-50'
              }`}>
                {verificationResults.missing === 0 ? (
                  <>
                    <Icons.CheckCircle2 className="w-5 h-5 text-green-500" />
                    <span className="text-green-700">
                      All {verificationResults.found} items verified in Arda!
                    </span>
                  </>
                ) : (
                  <>
                    <Icons.AlertTriangle className="w-5 h-5 text-yellow-500" />
                    <span className="text-yellow-700">
                      {verificationResults.found} found, {verificationResults.missing} not found in Arda
                    </span>
                  </>
                )}
              </div>
            )}

            <div className="max-h-96 overflow-y-auto divide-y divide-arda-border">
              {syncResults.map(result => (
                <div 
                  key={result.itemId}
                  className={`px-6 py-3 flex items-center justify-between ${
                    !result.success ? 'bg-red-50' : ''
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {result.success ? (
                      <Icons.CheckCircle2 className="w-5 h-5 text-green-500" />
                    ) : (
                      <Icons.XCircle className="w-5 h-5 text-red-500" />
                    )}
                    <div>
                      <div className="font-medium text-arda-text-primary">{result.itemName}</div>
                      {result.ardaEntityId && (
                        <div className="text-xs text-arda-text-muted font-mono">
                          ID: {result.ardaEntityId}
                        </div>
                      )}
                      {result.error && (
                        <div className="text-xs text-red-600">{result.error}</div>
                      )}
                    </div>
                  </div>
                  {result.success && (
                    <span className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-medium">
                      Synced
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Error message */}
          {syncError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3">
              <Icons.AlertTriangle className="w-5 h-5 text-red-500" />
              <span className="text-red-700">{syncError}</span>
            </div>
          )}

          {/* Success message */}
          {successCount > 0 && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-6 text-center">
              <Icons.PartyPopper className="w-12 h-12 mx-auto text-green-500 mb-3" />
              <h3 className="text-lg font-semibold text-green-800 mb-2">
                Items Successfully Imported!
              </h3>
              <p className="text-green-700 mb-4">
                {successCount} items have been added to your Arda inventory.
              </p>
              <button
                onClick={openArda}
                className="btn-arda-primary inline-flex items-center gap-2"
              >
                <Icons.ExternalLink className="w-4 h-4" />
                View in Arda
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};
