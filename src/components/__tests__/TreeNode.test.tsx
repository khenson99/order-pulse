import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TreeNode } from '../TreeNode';
import { JourneyNode, ItemVelocityProfile } from '../../types';

vi.mock('../ReorderSparkline', () => ({
  ReorderSparkline: ({ orders }: { orders: Array<{ date: string; quantity: number }> }) => (
    <div data-testid="sparkline" data-count={orders.length}>
      sparkline
    </div>
  ),
}));

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

  it('fires focus change and node click when row is clicked', () => {
    const handleClick = vi.fn();
    const handleFocus = vi.fn();

    render(
      <TreeNode
        node={baseNode}
        level={1}
        velocityProfiles={new Map([['test', velocityProfile]])}
        expandedNodes={new Set()}
        focusedNodeId={null}
        onNodeClick={handleClick}
        onExpandToggle={vi.fn()}
        onFocusChange={handleFocus}
      />,
    );

    fireEvent.click(screen.getByText('Test Line Item'));
    expect(handleClick).toHaveBeenCalledWith(expect.objectContaining({ id: 'line-1' }));
    expect(handleFocus).toHaveBeenCalledWith('line-1');
  });

  it('renders children when expanded by default', () => {
    const child: JourneyNode = {
      id: 'child-1',
      type: 'velocity',
      label: 'Velocity Node',
      children: [],
      data: {
        dailyBurnRate: 2,
        averageCadenceDays: 15,
        orderCount: 3,
      },
    };

    render(
      <TreeNode
        node={{ ...baseNode, children: [child] }}
        level={0}
        velocityProfiles={new Map([['test', velocityProfile]])}
        expandedNodes={undefined}
        focusedNodeId={null}
        onNodeClick={vi.fn()}
        onExpandToggle={vi.fn()}
        onFocusChange={vi.fn()}
      />,
    );

    expect(screen.getByText('Velocity Node')).toBeInTheDocument();
    expect(screen.getByTestId('sparkline')).toHaveAttribute('data-count', '2');
  });

  it('renders order and email specific details', () => {
    render(
      <>
        <TreeNode
          node={{
            id: 'order-1',
            type: 'order',
            label: 'Order Label',
            subtitle: 'order subtitle',
            children: [],
            data: { totalAmount: 123.45 },
          }}
          level={1}
          expandedNodes={new Set(['order-1'])}
        />
        <TreeNode
          node={{
            id: 'email-1',
            type: 'email',
            label: 'Email Label',
            subtitle: 'email subtitle',
            children: [],
            data: { date: '2024-02-10' },
          }}
          level={0}
          expandedNodes={new Set(['email-1'])}
        />
        <TreeNode
          node={{
            id: 'vel-1',
            type: 'velocity',
            label: 'Velocity',
            subtitle: 'velocity subtitle',
            children: [],
            data: { dailyBurnRate: 1.2, averageCadenceDays: 10, orderCount: 2, nextPredictedOrder: '2024-04-01' },
          }}
          level={2}
          expandedNodes={new Set(['vel-1'])}
        />
      </>,
    );

    expect(screen.getByText('$123.45')).toBeInTheDocument();
    const formattedDate = new Date('2024-02-10').toLocaleDateString();
    expect(screen.getByText(formattedDate)).toBeInTheDocument();
    expect(screen.getAllByText(/orders?/i).length).toBeGreaterThanOrEqual(1);
  });

  it('re-renders with memo comparator when props change', () => {
    const { rerender } = render(
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

    // same props should hit comparator return true path
    rerender(
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

    // changed focus should trigger comparator to return false and re-render
    rerender(
      <TreeNode
        node={baseNode}
        level={0}
        velocityProfiles={new Map([['test', velocityProfile]])}
        expandedNodes={new Set()}
        focusedNodeId="line-1"
        onNodeClick={vi.fn()}
        onExpandToggle={vi.fn()}
        onFocusChange={vi.fn()}
      />,
    );

    // mouse enter path for handleMouseEnter
    const row = screen.getByTestId('sparkline').closest('[data-node-id="line-1"]') || screen.getByText('Test Line Item').closest('[data-node-id="line-1"]');
    if (row) {
      fireEvent.mouseEnter(row);
    }
  });
});
