import type { FreestyleView } from '@may-cafe/contracts';
export function FreestyleRecipe({ value }: { value?: FreestyleView }): JSX.Element | null {
  if (!value) return null;
  return (
    <details className="mt-2 rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm">
      <summary className="cursor-pointer font-semibold">Công thức Freestyle</summary>
      <ul className="my-2 space-y-1">
        {value.components.map((c, i) => (
          <li key={i}>
            {c.name}: {c.quantity} {c.unit === 'unit' ? 'phần' : c.unit}
          </li>
        ))}
      </ul>
      <p className="whitespace-pre-line">{value.instructions}</p>
    </details>
  );
}
