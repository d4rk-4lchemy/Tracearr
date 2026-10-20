import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HourStrip, peakHourOf } from './HourStrip';

const data = Array.from({ length: 24 }, (_, hour) => ({ hour, count: hour === 22 ? 9 : 1 }));

describe('HourStrip', () => {
  it('renders 24 cells, outlines the peak and names both peaks in the caption', () => {
    const { container } = render(
      <HourStrip
        data={data}
        peakHour={22}
        peakLabel="peak 10 PM"
        comparePeakLabel="server peak 9 PM"
        label="Plays by hour"
      />
    );

    const cells = container.querySelectorAll('[data-hour]');
    expect(cells).toHaveLength(24);
    expect(container.querySelectorAll('[data-peak]')).toHaveLength(1);
    expect(cells[22]).toHaveAttribute('data-peak');
    expect(screen.getByRole('list', { name: 'Plays by hour' })).toBeInTheDocument();

    expect(screen.getByText('peak 10 PM · server peak 9 PM')).toBeInTheDocument();
  });

  it('fills hours missing from the data and leaves the caption out without a peak', () => {
    const { container } = render(
      <HourStrip data={[{ hour: 3, count: 2 }]} peakHour={null} label="Plays by hour" />
    );

    expect(container.querySelectorAll('[data-hour]')).toHaveLength(24);
    expect(container.querySelector('[data-peak]')).toBeNull();
    expect(container.querySelector('p')).toBeNull();
  });

  it('finds the busiest hour and none when nothing played', () => {
    expect(peakHourOf(data)).toBe(22);
    expect(peakHourOf([{ hour: 4, count: 0 }])).toBeNull();
  });
});
