import { render } from 'svelte/server';
import StartupShell from '../src/lib/StartupShell.svelte';
export function startupShell() {
  return render(StartupShell).body;
}
