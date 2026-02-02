import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReorderSparkline } from '../ReorderSparkline';

vi.mock('recharts', () => {
  const ReactImport = require('react');
  return {
    ResponsiveContainer: ({ children, width, height }: any) => (
      <div data-testid="responsive" style={{ width, height }}>
        {typeof children === 'function' ? children({ width, height }) : children}
      </div>
    ),
    LineChart: ({ children }: any) => <div data-testid="line-chart">{children}</div>,
    Line: (props: any) => <div data-testid="line" data-props={JSON.stringify(props)} />,
    Tooltip: (props: any) => {
      props.formatter?.(5);
      props.labelFormatter?.('label', [{ payload: { displayDate: 'Jan 2' } }]);
      props.labelFormatter?.('label', undefined);
      return <div data-testid="tooltip" />;
    },
  };
});

describe('ReorderSparkline', () => {
  it('shows placeholder when fewer than two orders', () => {
    render(<ReorderSparkline orders={[{ date: '2024-01-01', quantity: 1 }]} width={80} height={20} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders chart data when enough orders and executes tooltip formatters', () => {
    render(
      <ReorderSparkline
        orders={[
          { date: '2024-01-01', quantity: 2 },
          { date: '2024-02-01', quantity: 3 },
        ]}
      />,
    );

    expect(screen.getByTestId('responsive')).toBeInTheDocument();
    expect(screen.getByTestId('line-chart')).toBeInTheDocument();
    expect(screen.getByTestId('line')).toBeInTheDocument();
    expect(screen.getByTestId('tooltip')).toBeInTheDocument();
  });
});
