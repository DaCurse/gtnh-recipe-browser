export function normalize(value: string): string {
  return value.normalize('NFKD').toLocaleLowerCase().replace(/[^a-z0-9@:+.-]+/g, ' ').trim();
}
