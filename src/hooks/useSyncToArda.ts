import { useState, useCallback } from 'react';
import { API_BASE_URL, ardaApi, ArdaTenantResolutionDetails, isApiRequestError } from '../services/api';
import { exportItemsToCSV } from '../utils/exportUtils';
import type { MasterListItem, RowSyncState, SyncResult } from '../components/ItemsTable/types';

export function useSyncToArda(items: MasterListItem[]) {
  const [syncStateById, setSyncStateById] = useState<Record<string, RowSyncState>>({});
  const [isBulkSyncing, setIsBulkSyncing] = useState<boolean>(false);

  const uploadImage = useCallback(async (imageData: string): Promise<string | null> => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/photo/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ imageData }),
      });
      if (!response.ok) return null;
      const data = await response.json();
      return data.imageUrl ?? null;
    } catch {
      return null;
    }
  }, []);

  const resolveTenantForSync = useCallback(async (details?: ArdaTenantResolutionDetails): Promise<boolean> => {
    if (!details?.canCreateTenant) return false;
    try {
      const resolution = await ardaApi.resolveTenant('create_new');
      return resolution.success;
    } catch {
      return false;
    }
  }, []);

  const exportMasterListItemsFallback = useCallback((itemsToExport: MasterListItem[]) => {
    exportItemsToCSV(
      itemsToExport.map((item) => ({
        source: item.source,
        name: item.name,
        supplier: item.supplier,
        description: item.description,
        location: item.location,
        orderMethod: item.orderMethod,
        minQty: item.minQty,
        orderQty: item.orderQty,
        unitPrice: item.unitPrice,
        sku: item.sku,
        barcode: item.barcode,
        asin: item.asin,
        productUrl: item.productUrl,
        imageUrl: item.imageUrl,
        color: item.color,
      })),
      'master-list-tenant-unresolved'
    );
  }, []);

  const ensureTenantForSync = useCallback(async (itemsToExportOnFailure: MasterListItem[]): Promise<boolean> => {
    try {
      const status = await ardaApi.getTenantStatus();
      if (status.resolved) return true;
      const resolved = await resolveTenantForSync(status.details);
      if (resolved) return true;
      exportMasterListItemsFallback(itemsToExportOnFailure);
      return false;
    } catch (error) {
      if (isApiRequestError(error) && error.code === 'TENANT_REQUIRED') {
        const resolved = await resolveTenantForSync(error.details as ArdaTenantResolutionDetails | undefined);
        if (resolved) return true;
      }
      exportMasterListItemsFallback(itemsToExportOnFailure);
      return false;
    }
  }, [exportMasterListItemsFallback, resolveTenantForSync]);

  const syncItemToArda = useCallback(async (item: MasterListItem): Promise<SyncResult> => {
    try {
      let imageUrl = item.imageUrl;
      if (imageUrl?.startsWith('data:image/')) {
        const uploadedUrl = await uploadImage(imageUrl);
        imageUrl = uploadedUrl || undefined;
      }

      const payload = {
        name: item.name,
        primarySupplier: item.supplier || 'Unknown Supplier',
        orderMechanism: item.orderMethod,
        sku: item.sku,
        barcode: item.barcode,
        location: item.location,
        minQty: item.minQty || 1,
        orderQty: item.orderQty || item.minQty || 1,
        unitPrice: item.unitPrice,
        imageUrl,
        primarySupplierLink: item.productUrl,
        description: item.description,
      };

      const attemptSync = async (): Promise<{
        data?: { success: boolean; record?: { rId?: string } };
        error?: unknown;
      }> => {
        try {
          return { data: await ardaApi.createItem(payload) };
        } catch (error) {
          return { error };
        }
      };

      let attempt = await attemptSync();

      if (attempt.error && isApiRequestError(attempt.error) && attempt.error.code === 'TENANT_REQUIRED') {
        const resolved = await resolveTenantForSync(attempt.error.details as ArdaTenantResolutionDetails | undefined);
        if (resolved) {
          attempt = await attemptSync();
        } else {
          const tenantDetails = attempt.error.details as ArdaTenantResolutionDetails | undefined;
          const unresolvedMessage = tenantDetails?.autoProvisionError
            || tenantDetails?.message
            || 'Tenant could not be auto-provisioned.';
          exportMasterListItemsFallback([item]);
          return {
            success: false,
            error: `${unresolvedMessage} Exported item to CSV.`,
          };
        }
      }

      if (attempt.error) {
        if (isApiRequestError(attempt.error)) {
          const resolvedErrorMessage = attempt.error.message || '';
          if (
            attempt.error.status === 409 ||
            resolvedErrorMessage.toLowerCase().includes('already exists')
          ) {
            return { success: true, ardaEntityId: 'already-exists' };
          }
          const tenantDetails = attempt.error.details as ArdaTenantResolutionDetails | undefined;
          return {
            success: false,
            error: tenantDetails?.message || resolvedErrorMessage || 'Failed to sync item',
          };
        }
        return {
          success: false,
          error: attempt.error instanceof Error ? attempt.error.message : 'Unknown sync error',
        };
      }

      const data = attempt.data;
      return {
        success: true,
        ardaEntityId: data?.record?.rId,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown sync error',
      };
    }
  }, [exportMasterListItemsFallback, resolveTenantForSync, uploadImage]);

  const syncSingleItem = useCallback(async (id: string): Promise<boolean> => {
    const item = items.find(entry => entry.id === id);
    if (!item) return false;

    setSyncStateById(prev => ({
      ...prev,
      [id]: { status: 'syncing' },
    }));

    const result = await syncItemToArda(item);

    if (result.success) {
      setSyncStateById(prev => ({
        ...prev,
        [id]: { status: 'success', ardaEntityId: result.ardaEntityId },
      }));
      return true;
    }

    setSyncStateById(prev => ({
      ...prev,
      [id]: { status: 'error', error: result.error || 'Sync failed' },
    }));
    return false;
  }, [items, syncItemToArda]);

  const syncSelectedItems = useCallback(async (selectedIds: string[]) => {
    if (selectedIds.length === 0 || isBulkSyncing) return;

    setIsBulkSyncing(true);
    try {
      const selectedItems = items.filter(item => selectedIds.includes(item.id));
      const tenantReady = await ensureTenantForSync(selectedItems);
      if (!tenantReady) {
        selectedIds.forEach((id) => {
          setSyncStateById(prev => ({
            ...prev,
            [id]: { status: 'error', error: 'Tenant unresolved. Exported selected items to CSV.' },
          }));
        });
        return;
      }

      for (let i = 0; i < selectedIds.length; i += 1) {
        const id = selectedIds[i];
        await syncSingleItem(id);
        if (i < selectedIds.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    } finally {
      setIsBulkSyncing(false);
    }
  }, [ensureTenantForSync, isBulkSyncing, items, syncSingleItem]);

  return {
    syncStateById,
    setSyncStateById,
    isBulkSyncing,
    syncSingleItem,
    syncSelectedItems,
  };
}
