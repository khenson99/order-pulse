import type { CustomCellRendererProps } from 'ag-grid-react';
import { Icons } from '../../Icons';
import type { MasterListItem, RowSyncState } from '../types';

interface ActionsCellRendererProps extends CustomCellRendererProps<MasterListItem> {
  onSyncSingle?: (id: string) => void;
  onRemoveItem?: (id: string) => void;
  syncStateById?: Record<string, RowSyncState>;
}

export const ActionsCellRenderer = (props: ActionsCellRendererProps) => {
  const id = props.data?.id;
  if (!id) return null;

  const syncState = props.syncStateById?.[id];
  const isSyncing = syncState?.status === 'syncing';
  const isSynced = syncState?.status === 'success';

  return (
    <div className="flex items-center gap-1">
      {props.onSyncSingle && !isSynced && (
        <button
          type="button"
          onClick={() => props.onSyncSingle?.(id)}
          disabled={isSyncing}
          className="p-1 rounded hover:bg-orange-50 text-gray-500 hover:text-orange-600 transition-colors disabled:opacity-50"
          title="Sync to Arda"
        >
          {isSyncing ? (
            <Icons.Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Icons.Upload className="w-3.5 h-3.5" />
          )}
        </button>
      )}
      {props.onRemoveItem && (
        <button
          type="button"
          onClick={() => props.onRemoveItem?.(id)}
          className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
          title="Remove item"
        >
          <Icons.Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
};
