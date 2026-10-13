import { Minus, Plus } from 'lucide-react';

interface Props {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
}

export function QtyStepper({ value, onChange, min = 1, max = 50 }: Props): JSX.Element {
  const step =
    'grid h-10 w-10 place-items-center rounded-full text-foreground transition hover:bg-foreground/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-40 disabled:hover:bg-transparent';
  return (
    <div className="inline-flex items-center rounded-full bg-muted p-0.5">
      <button
        type="button"
        className={step}
        aria-label="Giảm số lượng"
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
      >
        <Minus className="h-4 w-4" />
      </button>
      <span className="w-8 text-center font-semibold tabular-nums" aria-live="polite">
        {value}
      </span>
      <button
        type="button"
        className={step}
        aria-label="Tăng số lượng"
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}
