export function CloudMark({ className }: { className?: string }): JSX.Element {
  return (
    <svg viewBox="0 0 38 26" fill="currentColor" aria-hidden="true" className={className}>
      <circle cx="11" cy="17" r="7" />
      <circle cx="21" cy="12" r="10" />
      <circle cx="30" cy="18" r="6" />
      <rect x="11" y="17" width="19" height="7" />
    </svg>
  );
}
