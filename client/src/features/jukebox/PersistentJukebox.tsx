import { lazy, Suspense, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useDocumentTitle } from '../../components/ui/useDocumentTitle';

const JukeboxPlayer = lazy(() =>
  import('./JukeboxPlayer').then((module) => ({ default: module.JukeboxPlayer })),
);

// The internal layout owns the player. Changing an outlet must not replace its
// media element, device identity, playback position or pending command.
export function PersistentJukebox({ admin = false }: { admin?: boolean }): JSX.Element | null {
  const { pathname } = useLocation();
  const onPage = pathname === `/${admin ? 'admin' : 'staff'}/jukebox`;
  const [opened, setOpened] = useState(onPage);
  useEffect(() => {
    if (onPage) setOpened(true);
  }, [onPage]);
  if (!opened) return null;
  return (
    <Suspense fallback={<p role="status">Đang tải Jukebox…</p>}>
      <JukeboxPlayer admin={admin} compact={!onPage} />
    </Suspense>
  );
}

export function JukeboxRoute(): null {
  useDocumentTitle('Jukebox');
  return null;
}
