const characterCount = 36;
const characterOffset = 128 - characterCount;

function characterIndex(character: string): number {
  const code = character.charCodeAt(0);
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 97 && code <= 122) return code - 97 + 10;
  return -1;
}

export function querySearchMask(term: string): number[] {
  const words = [0, 0, 0, 0];
  const setBit = (bit: number) => {
    const word = Math.trunc(bit / 32);
    words[word] = (words[word]! | (1 << (bit % 32))) >>> 0;
  };
  let previous = -1;
  let secondPrevious = -1;
  for (const character of term.toLowerCase()) {
    const current = characterIndex(character);
    if (current < 0) {
      previous = -1;
      secondPrevious = -1;
      continue;
    }
    setBit(characterOffset + current);
    if (previous >= 0) {
      setBit((previous * characterCount + current) % characterOffset);
      if (secondPrevious >= 0) {
        setBit(
          ((secondPrevious * characterCount + previous) * characterCount + current)
          % characterOffset
        );
      }
    }
    secondPrevious = previous;
    previous = current;
  }
  return words;
}

export function searchMaskContains(source: readonly number[], query: readonly number[]): boolean {
  if (source.length < 4 || query.length < 4) return true;
  return query.every(
    (word, index) => (((source[index]! >>> 0) & (word >>> 0)) >>> 0) === (word >>> 0)
  );
}
