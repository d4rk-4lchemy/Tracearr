import { cn } from '@/lib/utils';

interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  className?: string;
}

const PAD = 1.5;

export function Sparkline({ values, width = 80, height = 24, className }: SparklineProps) {
  const max = Math.max(...values, 0);
  if (max === 0) return null;

  const step = values.length > 1 ? width / (values.length - 1) : 0;
  const points = values
    .map((value, index) => {
      const y = height - PAD - (value / max) * (height - 2 * PAD);
      return `${+(index * step).toFixed(2)},${+y.toFixed(2)}`;
    })
    .join(' ');

  return (
    <svg
      aria-hidden="true"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn('text-primary shrink-0', className)}
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
