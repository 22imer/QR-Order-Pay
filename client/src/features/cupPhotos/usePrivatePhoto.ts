import { useEffect, useState } from 'react';
import { api, getErrorMessage } from '../../lib/api';

export function usePrivatePhoto(photoId: string | undefined, endpoint: string) {
  const [url, setUrl] = useState(''),
    [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false,
      objectUrl = '';
    setUrl('');
    setError('');
    if (photoId)
      void api
        .get(`${endpoint}/${photoId}`, { responseType: 'blob' })
        .then((response) => {
          if (cancelled) return;
          objectUrl = URL.createObjectURL(response.data as Blob);
          setUrl(objectUrl);
        })
        .catch((error: unknown) => {
          if (!cancelled) setError(getErrorMessage(error));
        });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photoId, endpoint]);
  return { url, error };
}
