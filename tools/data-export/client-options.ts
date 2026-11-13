import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Only called for the disposable client: keep automation ticking without focus. */
export async function configureUnattendedClient(gameDirectory: string): Promise<void> {
  const path = join(gameDirectory, 'options.txt');
  let options = await readFile(path, 'utf8').catch((error) => {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return '';
  });
  for (const key of ['pauseOnLostFocus', 'fullscreen']) {
    const pattern = new RegExp(`^${key}:.*$`, 'm');
    options = pattern.test(options)
      ? options.replace(pattern, `${key}:false`)
      : `${options}${options && !options.endsWith('\n') ? '\n' : ''}${key}:false\n`;
  }
  await writeFile(path, options);
}
