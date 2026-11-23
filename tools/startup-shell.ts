import { render } from 'svelte/server';
import StartupShell from '../src/lib/shell/StartupShell.svelte';
export function startupShell() {
  return render(StartupShell).body;
}
