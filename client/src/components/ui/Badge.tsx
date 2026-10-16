import { type ReactNode } from 'react';
import { cn } from '../../lib/cn';

interface BadgeProps {
  children: ReactNode;
  className?: string;
  tone?: 'neutral' | 'success' | 'danger' | 'warning' | 'info';
}

export function Badge({ children, className, tone = 'neutral' }: BadgeProps): JSX.Element {
  const toneClass =
    tone === 'success'
      ? 'bg-success/10 text-success'
      : tone === 'danger'
        ? 'bg-danger/10 text-danger'
        : tone === 'warning'
          ? 'bg-accent/20 text-accent-foreground'
          : tone === 'info'
            ? 'bg-primary/10 text-primary'
            : 'bg-muted text-muted-foreground';
  return (
    <span
      data-tone={tone}
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium',
        toneClass,
        className,
      )}
    >
      {children}
    </span>
  );
}
