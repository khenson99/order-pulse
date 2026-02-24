import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MasterListStep } from '../MasterListStep';
import type { MasterListItem, RowSyncState } from '../../components/ItemsTable/types';

function makeItem(overrides: Partial<MasterListItem> = {}): MasterListItem {
  return {
    id: 'item-1',
    source: 'email',
    orderMethod: 'online',
    name: 'Test Item',
    needsAttention: false,
    ...overrides,
  };
}

describe('MasterListStep', () => {
  const defaultProps = {
    items: [makeItem()],
    syncStateById: {} as Record<string, RowSyncState>,
    isBulkSyncing: false,
    onSyncSingle: vi.fn().mockResolvedValue(true),
    onSyncSelected: vi.fn().mockResolvedValue(undefined),
    onUpdateItem: vi.fn(),
    onRemoveItem: vi.fn(),
    onComplete: vi.fn(),
    onBack: vi.fn(),
    onFooterStateChange: vi.fn(),
  };

  it('does not render instruction card (tips are in header)', () => {
    render(<MasterListStep {...defaultProps} />);
    expect(screen.queryByText('What to do')).not.toBeInTheDocument();
  });

  it('shows item count', () => {
    render(<MasterListStep {...defaultProps} />);
    expect(screen.getByText('1 items')).toBeInTheDocument();
  });

  it('shows synced count', () => {
    render(
      <MasterListStep
        {...defaultProps}
        syncStateById={{ 'item-1': { status: 'success' } }}
      />,
    );
    expect(screen.getByText('1 synced')).toBeInTheDocument();
  });

  it('shows error count when items have sync errors', () => {
    render(
      <MasterListStep
        {...defaultProps}
        syncStateById={{ 'item-1': { status: 'error', error: 'Failed' } }}
      />,
    );
    expect(screen.getByText('1 failed')).toBeInTheDocument();
  });

  it('shows needs attention count', () => {
    render(
      <MasterListStep
        {...defaultProps}
        items={[makeItem({ needsAttention: true })]}
      />,
    );
    expect(screen.getByText('1 need attention')).toBeInTheDocument();
  });

  it('reports footer state via callback', () => {
    const onFooterStateChange = vi.fn();
    render(
      <MasterListStep
        {...defaultProps}
        onFooterStateChange={onFooterStateChange}
      />,
    );
    expect(onFooterStateChange).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedCount: 1,
        syncedCount: 0,
        canSyncSelected: true,
        canComplete: true,
        isSyncing: false,
      }),
    );
  });

  it('reports syncing state when bulk syncing', () => {
    const onFooterStateChange = vi.fn();
    render(
      <MasterListStep
        {...defaultProps}
        isBulkSyncing={true}
        onFooterStateChange={onFooterStateChange}
      />,
    );
    expect(onFooterStateChange).toHaveBeenCalledWith(
      expect.objectContaining({
        canSyncSelected: false,
        isSyncing: true,
      }),
    );
  });
});
