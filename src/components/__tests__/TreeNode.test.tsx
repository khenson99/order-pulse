import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TreeNode } from '../TreeNode';
import { JourneyNode, ItemVelocityProfile } from '../../types';

describe('TreeNode', () => {
  const baseNode: JourneyNode = {
    id: 'line-1',
    type: 'lineItem',
    label: 'Test Line Item',
    subtitle: 'Test Subtitle',
    children: [],
    data: {
      lineItemId: 'line-1',
      orderId: 'order-1',
      emailId: 'email-1',
      name: 'test',
      normalizedName: 'test',
      quantity: 2,
      unit: 'EA',
    },
  };

  const velocityProfile: ItemVelocityProfile = {
    normalizedName: 'test',
    displayName: 'Test Line Item',
    supplier: 'Test Supplier',
    orders: [
      { orderId: 'order-1', emailId: 'email-1', date: '2024-01-01', quantity: 1 },
      { orderId: 'order-2', emailId: 'email-2', date: '2024-02-01', quantity: 1 },
    ],
    totalQuantityOrdered: 2,
    orderCount: 2,
    averageCadenceDays: 30,
    dailyBurnRate: 1.5,
    firstOrderDate: '2024-01-01',
    lastOrderDate: '2024-02-01',
    nextPredictedOrder: '2024-03-15',
    recommendedMin: 1,
    recommendedOrderQty: 2,
  };

  it('renders the label with velocity data', () => {
    render(
      <TreeNode
        node={baseNode}
        level={0}
        velocityProfiles={new Map([['test', velocityProfile]])}
        expandedNodes={new Set()}
        focusedNodeId={null}
        onNodeClick={vi.fn()}
        onExpandToggle={vi.fn()}
        onFocusChange={vi.fn()}
      />,
    );

    expect(screen.getByText('Test Line Item')).toBeInTheDocument();
    expect(screen.getByText(/1\.5\/day/)).toBeInTheDocument();
  });

  it('calls expand toggle handler when the chevron button is clicked', async () => {
    const toggle = vi.fn();

    render(
      <TreeNode
        node={baseNode}
        level={0}
        velocityProfiles={new Map([['test', velocityProfile]])}
        expandedNodes={new Set()}
        focusedNodeId={null}
        onNodeClick={vi.fn()}
        onExpandToggle={toggle}
        onFocusChange={vi.fn()}
      />,
    );

    const button = screen.getByRole('button', { name: /expand/i });
    await button.click();
    expect(toggle).toHaveBeenCalled();
  });
});
