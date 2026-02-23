import type { CustomCellRendererProps } from 'ag-grid-react';
import { Icons } from '../../Icons';
import type { MasterListItem, RowSyncState } from '../types';

interface SyncStatusRendererProps extends CustomCellRendererProps<MasterListItem> {
  syncStateById?: Record<string, RowSyncState>;
}

export const SyncStatusRenderer = (props: SyncStatusRendererProps) => {
  const syncState = props.syncStateById?.[props.data?.id ?? ''];
  const status = syncState?.status ?? 'idle';

  switch (status) {
    case 'syncing':
      return <Icons.Loader2 className="w-4 h-4 text-orange-500 animate-spin" />;
    case 'success':
      return <Icons.CheckCircle2 className="w-4 h-4 text-green-500" />;
    case 'error':
      return (
        <span title={syncState?.error}>
          <Icons.AlertCircle className="w-4 h-4 text-red-500" />
        </span>
      );
    default:
      return <span className="w-4 h-4 rounded-full border-2 border-dashed border-gray-300 inline-block" />;
  }
};
