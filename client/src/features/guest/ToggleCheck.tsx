import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

interface Props {
  checked: boolean;
  onChange: (value: boolean) => void;
  children: ReactNode;
}

export function ToggleCheck({ checked, onChange, children }: Props): JSX.Element {
  return (
    <label
      className={cn(
        'flex h-11 cursor-pointer items-center gap-2 rounded-full border px-4 text-sm font-medium transition focus-within:ring-2 focus-within:ring-primary/40',
        checked ? 'border-primary bg-primary/10 text-primary' : 'border-foreground/15 bg-card',
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 accent-[rgb(var(--c-primary))]"
      />
      {children}
    </label>
  );
}
