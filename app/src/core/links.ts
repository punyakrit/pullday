const PLACES = ['collection', 'streak', 'shop', 'account'];

/** Where a link from outside leads. What we do not know leads to Today. */
export function placeOf(link: string): string {
  const path = link
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    .replace(/[?#].*$/s, '')
    .split('/')
    .filter((part) => part !== '' && !/^\(.*\)$/.test(part));
  if (path.length === 1 && PLACES.includes(path[0]!)) return `/${path[0]}`;
  if (path.length === 2 && path[0] === 'card' && /^[\w-]{1,40}$/.test(path[1]!)) return `/card/${path[1]}`;
  return '/';
}
