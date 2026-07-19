export function itemListUrl(currentUrl: string | URL): URL {
  const url = new URL(currentUrl);
  url.searchParams.delete('item');
  url.searchParams.delete('view');
  return url;
}
