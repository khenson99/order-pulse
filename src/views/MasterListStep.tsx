import { useMemo, useCallback, useEffect } from 'react';
import { InstructionCard } from '../components/InstructionCard';
import type { MasterListItem, RowSyncState, MasterListFooterState } from '../components/ItemsTable/types';

interface MasterListStepProps {
  items: MasterListItem[];
  syncStateById: Record<string, RowSyncState>;
  isBulkSyncing: boolean;
  onSyncSingle: (id: string) => Promise<boolean>;
  onSyncSelected: (ids: string[]) => Promise<void>;
  onUpdateItem: (id: string, field: keyof MasterListItem, value: unknown) => void;
  onRemoveItem: (id: string) => void;
  onComplete: () => void;
  onBack: () => void;
  onFooterStateChange?: (state: MasterListFooterState) => void;
}

export { type MasterListItem } from '../components/ItemsTable/types';
export { type MasterListFooterState } from '../components/ItemsTable/types';

export const MasterListStep: React.FC<MasterListStepProps> = ({
  items,
  syncStateById,
  isBulkSyncing,
  onSyncSelected,
  onComplete,
  onBack,
  onFooterStateChange,
}) => {
  void onBack;

  const syncedItems = useMemo(
    () => items.filter(item => syncStateById[item.id]?.status === 'success'),
    [items, syncStateById],
  );

  const hasSyncInProgress = useMemo(
    () => isBulkSyncing || Object.values(syncStateById).some(state => state.status === 'syncing'),
    [isBulkSyncing, syncStateById],
  );

  const handleComplete = useCallback(() => {
    onComplete();
  }, [onComplete]);

  const handleSyncSelected = useCallback(() => {
    const allIds = items.map(item => item.id);
    void onSyncSelected(allIds);
  }, [items, onSyncSelected]);

  useEffect(() => {
    onFooterStateChange?.({
      selectedCount: items.length,
      syncedCount: syncedItems.length,
      canSyncSelected: items.length > 0 && !hasSyncInProgress,
      canComplete: !hasSyncInProgress,
      isSyncing: isBulkSyncing,
      onSyncSelected: handleSyncSelected,
      onComplete: handleComplete,
    });
  }, [
    handleComplete,
    handleSyncSelected,
    hasSyncInProgress,
    isBulkSyncing,
    items.length,
    onFooterStateChange,
    syncedItems.length,
  ]);

  return (
    <div className="space-y-4">
      <InstructionCard
        variant="compact"
        title="What to do"
        icon="ListChecks"
        steps={[
          'Review and edit item details in the grid below.',
          'Select items and sync to Arda.',
          'Complete setup when ready.',
        ]}
      />

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4 text-sm">
          <span className="font-medium">{items.length} items</span>
          <span className="text-green-600">{syncedItems.length} synced</span>
          {items.filter(i => syncStateById[i.id]?.status === 'error').length > 0 && (
            <span className="text-red-600">
              {items.filter(i => syncStateById[i.id]?.status === 'error').length} failed
            </span>
          )}
          {items.filter(i => i.needsAttention).length > 0 && (
            <span className="text-orange-600">
              {items.filter(i => i.needsAttention).length} need attention
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
