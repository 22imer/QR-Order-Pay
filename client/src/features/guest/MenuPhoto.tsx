import { useState } from 'react';
import { Coffee } from 'lucide-react';
import { cn } from '../../lib/cn';
import { menuImageSource } from './menuImages';

export function MenuPhoto({
  source,
  className,
  eager = false,
}: {
  source: string;
  className?: string;
  eager?: boolean;
}): JSX.Element {
  const [failed, setFailed] = useState('');
  const src = menuImageSource(source);
  return (
    <span className={cn('relative block h-full w-full overflow-hidden bg-muted', className)}>
      {src && failed !== src ? (
        <img
          src={src}
          alt=""
          className="h-full w-full object-cover"
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          onError={() => setFailed(src)}
        />
      ) : (
        <Coffee
          aria-hidden="true"
          className="absolute left-1/2 top-1/2 h-14 w-14 -translate-x-1/2 -translate-y-1/2 opacity-25"
        />
      )}
    </span>
  );
}
