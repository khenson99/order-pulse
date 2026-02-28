import { useCallback, useMemo, useRef } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, GridReadyEvent, CellValueChangedEvent, GetRowIdParams, RowClassRules } from 'ag-grid-community';
import { themeQuartz } from 'ag-grid-community';
import './gridSetup';
import './ardaGridTheme.css';
import type { MasterListItem, RowSyncState } from './types';
import { ORDER_METHOD_OPTIONS } from './types';
import { SourceBadgeRenderer } from './cellRenderers/SourceBadgeRenderer';
import { ImageCellRenderer } from './cellRenderers/ImageCellRenderer';
import { ColorCellRenderer } from './cellRenderers/ColorCellRenderer';
import { ColorCellEditor } from './cellRenderers/ColorCellEditor';
import { SyncStatusRenderer } from './cellRenderers/SyncStatusRenderer';
import { ActionsCellRenderer } from './cellRenderers/ActionsCellRenderer';
import { UrlCellRenderer } from './cellRenderers/UrlCellRenderer';

const ardaTheme = themeQuartz.withParams({
  fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
  fontSize: 13,
  backgroundColor: '#ffffff',
  headerBackgroundColor: '#f9fafb',
  oddRowBackgroundColor: '#ffffff',
  rowHoverColor: '#f9fafb',
  headerCellHoverBackgroundColor: '#f3f4f6',
  selectedRowBackgroundColor: '#fff7ed',
  modalOverlayBackgroundColor: 'rgba(0, 0, 0, 0.3)',
  rangeSelectionBorderColor: '#FC5A29',
  rangeSelectionBackgroundColor: 'rgba(252, 90, 41, 0.08)',
  accentColor: '#FC5A29',
  borderColor: '#e5e7eb',
  headerTextColor: '#4b5563',
  foregroundColor: '#1f2937',
  subtleTextColor: '#6b7280',
  spacing: 4,
  cellHorizontalPadding: 8,
  headerHeight: 36,
  rowHeight: 38,
  wrapperBorderRadius: 12,
  borderRadius: 6,
  cardShadow: '0 1px 3px 0 rgba(0,0,0,0.1), 0 1px 2px -1px rgba(0,0,0,0.1)',
  popupShadow: '0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1)',
});

export interface ItemsGridProps {
  items: MasterListItem[];
  onUpdateItem: (id: string, field: keyof MasterListItem, value: unknown) => void;
  onRemoveItem: (id: string) => void;
  syncStateById: Record<string, RowSyncState>;
  onSyncSingle?: (id: string) => void;
  mode: 'panel' | 'fullpage';
}

export const ItemsGrid: React.FC<ItemsGridProps> = ({
  items,
  onUpdateItem,
  onRemoveItem,
  syncStateById,
  onSyncSingle,
  mode,
}) => {
  const gridRef = useRef<AgGridReact<MasterListItem>>(null);

  const getRowId = useCallback((params: GetRowIdParams<MasterListItem>) => params.data.id, []);

  const onCellValueChanged = useCallback(
    (event: CellValueChangedEvent<MasterListItem>) => {
      const field = event.colDef.field as keyof MasterListItem | undefined;
      if (field && event.data) {
        onUpdateItem(event.data.id, field, event.newValue);
      }
    },
    [onUpdateItem],
  );

  const onGridReady = useCallback((event: GridReadyEvent) => {
    event.api.sizeColumnsToFit();
  }, []);

  const columnDefs = useMemo<ColDef<MasterListItem>[]>(
    () => [
      {
        headerCheckboxSelection: true,
        checkboxSelection: true,
        width: 44,
        maxWidth: 44,
        pinned: 'left',
        suppressMenu: true,
        resizable: false,
        sortable: false,
        filter: false,
        editable: false,
        lockPosition: true,
      },
      {
        headerName: 'Source',
        field: 'source',
        width: 90,
        maxWidth: 100,
        cellRenderer: SourceBadgeRenderer,
        editable: false,
        enableRowGroup: true,
        filter: 'agSetColumnFilter',
      },
      {
        headerName: 'Img',
        field: 'imageUrl',
        width: 56,
        maxWidth: 56,
        cellRenderer: ImageCellRenderer,
        editable: false,
        sortable: false,
        filter: false,
      },
      {
        headerName: 'Name',
        field: 'name',
        minWidth: 160,
        flex: 2,
        editable: true,
        filter: 'agTextColumnFilter',
        pinned: mode === 'fullpage' ? 'left' : undefined,
        rowDrag: true,
      },
      {
        headerName: 'Supplier',
        field: 'supplier',
        minWidth: 120,
        flex: 1,
        editable: true,
        filter: 'agTextColumnFilter',
        enableRowGroup: true,
      },
      {
        headerName: 'Order Method',
        field: 'orderMethod',
        width: 130,
        editable: true,
        cellEditor: 'agSelectCellEditor',
        cellEditorParams: {
          values: ORDER_METHOD_OPTIONS.map((o) => o.value),
        },
        valueFormatter: (params) => {
          const opt = ORDER_METHOD_OPTIONS.find((o) => o.value === params.value);
          return opt?.label ?? (params.value as string);
        },
      },
      {
        headerName: 'Location',
        field: 'location',
        width: 100,
        editable: true,
        filter: 'agTextColumnFilter',
      },
      {
        headerName: 'SKU',
        field: 'sku',
        width: 100,
        editable: true,
      },
      {
        headerName: 'Barcode',
        field: 'barcode',
        width: 110,
        editable: true,
        hide: mode === 'panel',
      },
      {
        headerName: 'Min',
        field: 'minQty',
        width: 70,
        editable: true,
        cellEditor: 'agNumberCellEditor',
        type: 'numericColumn',
        valueParser: (params) => {
          const val = Number(params.newValue);
          return isNaN(val) ? params.oldValue : val;
        },
      },
      {
        headerName: 'Order',
        field: 'orderQty',
        width: 70,
        editable: true,
        cellEditor: 'agNumberCellEditor',
        type: 'numericColumn',
        valueParser: (params) => {
          const val = Number(params.newValue);
          return isNaN(val) ? params.oldValue : val;
        },
      },
      {
        headerName: 'Price',
        field: 'unitPrice',
        width: 80,
        editable: true,
        cellEditor: 'agNumberCellEditor',
        type: 'numericColumn',
        valueFormatter: (params) => {
          if (params.value == null) return '—';
          return `$${Number(params.value).toFixed(2)}`;
        },
        valueParser: (params) => {
          const cleaned = String(params.newValue).replace(/[$,]/g, '');
          const val = Number(cleaned);
          return isNaN(val) ? params.oldValue : val;
        },
      },
      {
        headerName: 'Color',
        field: 'color',
        width: 100,
        cellRenderer: ColorCellRenderer,
        cellEditor: ColorCellEditor,
        editable: true,
      },
      {
        headerName: 'Product URL',
        field: 'productUrl',
        width: 130,
        cellRenderer: UrlCellRenderer,
        editable: true,
        hide: mode === 'panel',
      },
      {
        headerName: 'Status',
        colId: 'syncStatus',
        width: 60,
        maxWidth: 60,
        cellRenderer: SyncStatusRenderer,
        cellRendererParams: { syncStateById },
        editable: false,
        sortable: false,
        filter: false,
      },
      {
        headerName: '',
        colId: 'actions',
        width: 80,
        maxWidth: 80,
        cellRenderer: ActionsCellRenderer,
        cellRendererParams: { onSyncSingle, onRemoveItem, syncStateById },
        editable: false,
        sortable: false,
        filter: false,
        pinned: 'right',
      },
    ],
    [mode, syncStateById, onSyncSingle, onRemoveItem],
  );

  const defaultColDef = useMemo<ColDef>(
    () => ({
      resizable: true,
      sortable: true,
      filter: true,
      suppressMovable: false,
    }),
    [],
  );

  const rowClassRules = useMemo<RowClassRules<MasterListItem>>(
    () => ({
      'row-needs-attention': (params) => !!params.data?.needsAttention,
      'row-sync-success': (params) => syncStateById[params.data?.id ?? '']?.status === 'success',
      'row-sync-error': (params) => syncStateById[params.data?.id ?? '']?.status === 'error',
    }),
    [syncStateById],
  );

  const containerHeight = mode === 'fullpage' ? 'calc(100vh - 160px)' : '100%';

  return (
    <div className="flex flex-col h-full">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 bg-gray-50/50">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-gray-700">Item Ledger</h3>
          <span className="text-xs text-gray-500">{items.length} items</span>
          {Object.values(syncStateById).filter((s) => s.status === 'success').length > 0 && (
            <span className="text-xs text-green-600">
              {Object.values(syncStateById).filter((s) => s.status === 'success').length} synced
            </span>
          )}
          {Object.values(syncStateById).filter((s) => s.status === 'error').length > 0 && (
            <span className="text-xs text-red-600">
              {Object.values(syncStateById).filter((s) => s.status === 'error').length} failed
            </span>
          )}
        </div>
      </div>

      {/* Grid */}
      <div className="ag-theme-arda flex-1" style={{ height: containerHeight, width: '100%' }}>
        <AgGridReact<MasterListItem>
          ref={gridRef}
          theme={ardaTheme}
          rowData={items}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          getRowId={getRowId}
          rowClassRules={rowClassRules}
          onCellValueChanged={onCellValueChanged}
          onGridReady={onGridReady}
          // Selection
          rowSelection="multiple"
          suppressRowClickSelection
          // Editing
          singleClickEdit
          stopEditingWhenCellsLoseFocus
          // Enterprise features
          enableRangeSelection
          enableFillHandle
          undoRedoCellEditing
          undoRedoCellEditingLimit={20}
          // Row drag
          rowDragManaged
          animateRows
          // Performance
          suppressColumnVirtualisation={items.length < 100}
          rowBuffer={10}
          // Empty state
          overlayNoRowsTemplate='<div class="p-8 text-center text-gray-400"><div class="text-lg mb-1">No items yet</div><div class="text-sm">Items will appear here as you collect them from each step.</div></div>'
        />
      </div>
    </div>
  );
};
