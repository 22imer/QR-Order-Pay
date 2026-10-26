import { useCallback, useRef, useState } from 'react';

export function useCupPhotoBusy() {
  const locks = useRef(new Set<string>());
  const [photoBusy, setBusy] = useState(false);
  const setPhotoBusy = useCallback((key: string, busy: boolean) => {
    if (busy) locks.current.add(key);
    else locks.current.delete(key);
    setBusy(locks.current.size > 0);
  }, []);
  return { photoBusy, setPhotoBusy };
}
