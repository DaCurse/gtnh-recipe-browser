import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Keep disposable clients muted and ticking without focus. */
export async function configureUnattendedClient(gameDirectory: string): Promise<void> {
  const path = join(gameDirectory, 'options.txt');
  let options = await readFile(path, 'utf8').catch((error) => {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return '';
  });
  for (const [key, value] of Object.entries({
    pauseOnLostFocus: 'false',
    fullscreen: 'false',
    soundCategory_master: '0.0',
  })) {
    const pattern = new RegExp(`^${key}:.*$`, 'm');
    options = pattern.test(options)
      ? options.replace(pattern, `${key}:${value}`)
      : `${options}${options && !options.endsWith('\n') ? '\n' : ''}${key}:${value}\n`;
  }
  await writeFile(path, options);
}
