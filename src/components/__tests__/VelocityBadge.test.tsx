import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VelocityBadge } from '../VelocityBadge';

describe('VelocityBadge', () => {
  it('renders compact badge with correct rate', () => {
    render(
      <VelocityBadge
        dailyBurnRate={5}
        averageCadenceDays={12}
        orderCount={3}
        compact
      />,
    );

    expect(screen.getByText(/5\.0\/day/)).toBeInTheDocument();
    expect(screen.getByTitle(/12 days/)).toBeInTheDocument();
  });

  it('renders detailed badge with next predicted order and pluralization', () => {
    render(
      <VelocityBadge
        dailyBurnRate={0.2}
        averageCadenceDays={45}
        orderCount={1}
        nextPredictedOrder="2024-08-15"
      />,
    );

    expect(screen.getByText(/0\.2\/day/)).toBeInTheDocument();
    expect(screen.getByText(/45 days/)).toBeInTheDocument();
    expect(screen.getByText(/1 order/)).toBeInTheDocument();
    expect(screen.getByText(/Next:/)).toBeInTheDocument();
  });

  it('shows correct classification labels across ranges', () => {
    render(
      <>
        <VelocityBadge dailyBurnRate={12} averageCadenceDays={5} orderCount={10} />
        <VelocityBadge dailyBurnRate={3} averageCadenceDays={5} orderCount={10} />
        <VelocityBadge dailyBurnRate={1} averageCadenceDays={5} orderCount={10} />
        <VelocityBadge dailyBurnRate={0} averageCadenceDays={5} orderCount={10} />
      </>,
    );

    expect(screen.getAllByText('(Fast)')).toHaveLength(1);
    expect(screen.getAllByText('(Medium)')).toHaveLength(1);
    expect(screen.getAllByText('(Slow)')).toHaveLength(1);
    expect(screen.getAllByText('(Rare)')).toHaveLength(1);
  });
});
