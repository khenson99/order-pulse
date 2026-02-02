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
        normalizedName: 'test-item',
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
            data: { orderId: 'o1', emailId: 'e1', supplier: 'Test', orderDate: '2024-01-01', itemCount: 1, confidence: 0.9, totalAmount: 123.45 },
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
            data: { emailId: 'e1', sender: 'test@test.com', subject: 'Test', date: '2024-02-10' },
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
            data: { normalizedName: 'test', dailyBurnRate: 1.2, averageCadenceDays: 10, orderCount: 2, nextPredictedOrder: '2024-04-01' },
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

  it('falls back to default styling for unknown node types', () => {
    render(
      <TreeNode
        node={{
          id: 'unknown-1',
          // @ts-expect-error testing default branch
          type: 'unknown',
          label: 'Unknown Node',
          children: [],
        }}
        level={0}
      />,
    );

    expect(screen.getByText('Unknown Node')).toBeInTheDocument();
  });

  it('exposes memo comparator that reacts to expanded state and handlers', () => {
    const comparator = (TreeNode as unknown as { compare: (prev: unknown, next: unknown) => boolean }).compare;
    const sharedNode = { ...baseNode };
    const sharedVelocity = new Map([['test', velocityProfile]]);
    const baseProps = {
      node: sharedNode,
      level: 0,
      velocityProfiles: sharedVelocity,
      expandedNodes: new Set<string>(),
      focusedNodeId: null,
      onNodeClick: vi.fn(),
      onExpandToggle: vi.fn(),
      onFocusChange: vi.fn(),
    };

    // identical props should be equal
    expect(comparator(baseProps, { ...baseProps })).toBe(true);

    // different expansion state should trigger a re-render decision
    const expandedProps = { ...baseProps, expandedNodes: new Set(['line-1']) };
    expect(comparator(baseProps, expandedProps)).toBe(false);

    // different handler identity should trigger re-render
    const handlerChanged = { ...baseProps, onNodeClick: vi.fn() };
    expect(comparator(baseProps, handlerChanged)).toBe(false);
  });

  it('renders line item even when velocity data is missing', () => {
    render(
      <TreeNode
        node={{
          id: 'line-no-velocity',
          type: 'lineItem',
          label: 'No Velocity',
          // omit children to exercise hasChildren optional path
          data: { name: 'No Velocity Item', quantity: 1, unit: 'ea' },
        } as JourneyNode}
        level={0}
        velocityProfiles={new Map()}
      />,
    );

    expect(screen.getByText('No Velocity')).toBeInTheDocument();
  });

  it('shows new-node styling when isNew is true', () => {
    const { container } = render(
      <TreeNode
        node={{
          ...baseNode,
          id: 'line-new',
          label: 'Brand New',
          isNew: true,
          children: [],
        }}
        level={0}
        velocityProfiles={new Map([['test', velocityProfile]])}
      />,
    );

    expect(screen.getByText('Brand New')).toBeInTheDocument();
    expect(container.querySelector('[data-node-id="line-new"]')?.className).toMatch(/animate-pulse/);
  });

  it('renders collapsed child container when not expanded at deeper levels', () => {
    render(
      <TreeNode
        node={{
          ...baseNode,
          id: 'parent-collapsed',
          children: [
            {
              id: 'nested',
              type: 'lineItem',
              label: 'Nested Child',
              children: [],
              data: { lineItemId: 'li1', orderId: 'o1', emailId: 'e1', name: 'n', quantity: 1, unit: 'ea', normalizedName: 'n' },
            },
          ],
        }}
        level={2}
        expandedNodes={new Set<string>()}
        velocityProfiles={new Map()}
      />,
    );

    expect(screen.getByText('Nested Child')).toBeInTheDocument();
  });

  it('omits order amount badge when total is missing', () => {
    render(
      <TreeNode
        node={{
          id: 'order-no-amount',
          type: 'order',
          label: 'Order Missing Amount',
          subtitle: 'no amount',
          children: [],
          data: { orderId: 'o1', emailId: 'e1', supplier: 'Test', orderDate: '2024-01-01', itemCount: 1, confidence: 0.9 },
        }}
        level={0}
        expandedNodes={new Set()}
      />,
    );

    expect(screen.getByText('Order Missing Amount')).toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });

  it('handles order total of zero without rendering amount badge', () => {
    render(
      <TreeNode
        node={{
          id: 'order-zero',
          type: 'order',
          label: 'Zero Amount',
          subtitle: 'zero total',
          children: [],
          data: { orderId: 'o1', emailId: 'e1', supplier: 'Test', orderDate: '2024-01-01', itemCount: 1, confidence: 0.9, totalAmount: 0 },
        }}
        level={0}
        expandedNodes={new Set()}
      />,
    );

    expect(screen.getByText('Zero Amount')).toBeInTheDocument();
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
  });

  it('covers memo comparator branches for mismatched props', () => {
    const comparator = (TreeNode as unknown as { compare: (prev: unknown, next: unknown) => boolean }).compare;
    const makeProps = (overrides: Record<string, unknown> = {}) => {
      const nodeOverride = overrides.node ?? {};
      return {
        node: { ...baseNode, ...nodeOverride },
        level: overrides.level ?? 0,
        velocityProfiles: overrides.velocityProfiles ?? new Map([['test', velocityProfile]]),
        expandedNodes: Object.prototype.hasOwnProperty.call(overrides, 'expandedNodes')
          ? overrides.expandedNodes
          : new Set<string>(),
        focusedNodeId: overrides.focusedNodeId ?? null,
        onNodeClick: overrides.onNodeClick ?? baseClick,
        onExpandToggle: overrides.onExpandToggle ?? baseExpand,
        onFocusChange: overrides.onFocusChange ?? baseFocus,
      };
    };

    const baseClick = vi.fn();
    const baseExpand = vi.fn();
    const baseFocus = vi.fn();

    const baseProps = makeProps();
    expect(comparator(baseProps, baseProps)).toBe(true);
    expect(comparator(baseProps, makeProps({ node: { ...baseProps.node, id: 'other' } }))).toBe(false);
    expect(comparator(baseProps, makeProps({ level: 2 }))).toBe(false);
    expect(comparator(baseProps, makeProps({ node: { ...baseProps.node, label: 'Changed' } }))).toBe(false);
    expect(comparator(baseProps, makeProps({ node: { ...baseProps.node, subtitle: 'Changed subtitle' } }))).toBe(false);
    expect(comparator(baseProps, makeProps({ node: { ...baseProps.node, type: 'order' as JourneyNode['type'] } }))).toBe(false);
    expect(comparator(baseProps, makeProps({ node: { ...baseProps.node, isNew: true } }))).toBe(false);
    expect(comparator(baseProps, makeProps({ node: { ...baseProps.node, data: { ...baseProps.node.data } } }))).toBe(false);
    expect(comparator(baseProps, makeProps({ expandedNodes: undefined }))).toBe(false);
    expect(comparator(baseProps, makeProps({ expandedNodes: new Set(['line-1']) }))).toBe(false);
    expect(comparator(baseProps, makeProps({ focusedNodeId: 'line-1' }))).toBe(false);
    expect(comparator(baseProps, makeProps({ velocityProfiles: new Map() }))).toBe(false);
    expect(comparator(baseProps, makeProps({ onNodeClick: vi.fn(), onExpandToggle: baseExpand, onFocusChange: baseFocus }))).toBe(false);
    expect(comparator(baseProps, { ...baseProps, onExpandToggle: vi.fn() })).toBe(false);
    expect(comparator(baseProps, { ...baseProps, onFocusChange: vi.fn() })).toBe(false);
  });
});
