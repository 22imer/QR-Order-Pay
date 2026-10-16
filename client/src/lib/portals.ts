export type PortalMode = 'unified' | 'guest' | 'staff' | 'admin';

export interface PortalUrls {
  guest: string;
  staff: string;
  admin: string;
}

export function getPortalUrls(): PortalUrls {
  return {
    guest: configuredOrigin(import.meta.env.VITE_GUEST_APP_URL as string | undefined, '8080'),
    staff: configuredOrigin(import.meta.env.VITE_STAFF_APP_URL as string | undefined, '8081'),
    admin: configuredOrigin(import.meta.env.VITE_ADMIN_APP_URL as string | undefined, '8082'),
  };
}

export function getPortalMode(origin = window.location.origin): PortalMode {
  const servedPortal = document.querySelector<HTMLMetaElement>(
    'meta[name="fantastic-cafe-portal"]',
  )?.content;
  if (
    origin === window.location.origin &&
    (servedPortal === 'guest' || servedPortal === 'staff' || servedPortal === 'admin')
  )
    return servedPortal;
  const current = normalizeOrigin(origin);
  const urls = getPortalUrls();
  if (current === normalizeOrigin(urls.guest)) return 'guest';
  if (current === normalizeOrigin(urls.staff)) return 'staff';
  if (current === normalizeOrigin(urls.admin)) return 'admin';
  return 'unified';
}

export function portalHome(portal: PortalMode): string {
  if (portal === 'staff') return '/staff';
  if (portal === 'admin') return '/admin';
  return '/t';
}

function configuredOrigin(value: string | undefined, port: string): string {
  if (value) return normalizeOrigin(value);
  const url = new URL(window.location.origin);
  url.port = port;
  return url.origin;
}

function normalizeOrigin(value: string): string {
  return new URL(value).origin;
}
