import cachedImages from './menu-image-cache.json';

const imageCache: Record<string, string> = cachedImages;
export const menuImageSource = (source: string): string => imageCache[source] ?? source;
