<script lang="ts">
  import LoadingProgress from '../ui/LoadingProgress.svelte';
  let {
    status,
    stage,
    progress,
    loadingVersion,
    error,
    retry,
  }: {
    status: 'loading' | 'error';
    stage: string;
    progress: number;
    loadingVersion?: string;
    error: string;
    retry: () => void;
  } = $props();
  let errorCopied = $state(false);
  $effect(() => {
    if (!error) errorCopied = false;
  });
  async function copyError() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(error);
      } else {
        const field = document.createElement('textarea');
        field.value = error;
        field.style.position = 'fixed';
        field.style.opacity = '0';
        document.body.append(field);
        field.select();
        document.execCommand('copy');
        field.remove();
      }
      errorCopied = true;
      window.setTimeout(() => (errorCopied = false), 1800);
    } catch {
      errorCopied = false;
    }
  }
</script>

<main class="state-main">
  {#if status === 'loading'}
    <LoadingProgress
      title="Loading items…"
      detail={loadingVersion ? `GTNH ${loadingVersion} · ${stage}` : stage}
      {progress}
      label="Item catalogue loading"
    />
  {:else}
    <section class="app-state app-error" aria-live="assertive">
      <span class="error-mark" aria-hidden="true">!</span>
      <h1>Catalog failed to load</h1>
      <p>The browser could not verify or open the active GTNH dataset.</p>
      <pre>{error}</pre>
      <div class="state-actions">
        <button class="mc-button" onclick={copyError}
          >{errorCopied ? 'Copied' : 'Copy error'}</button
        >
        <button class="mc-button primary" onclick={retry}>Try again</button>
      </div>
    </section>
  {/if}
</main>

<style>
  .state-main {
    display: flex;
    align-items: center;
    justify-content: center;
    grid-template-columns: 1fr;
    place-items: center;
    overflow: auto;
    padding: 28px;
  }
  .app-state {
    width: min(620px, 100%);
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 52px 34px;
    border: 1px solid #3c4044;
    border-radius: 14px;
    background: #1b1d20;
    box-shadow: 0 24px 80px #0007;
    text-align: center;
  }
  .app-state h1 {
    margin: 22px 0 8px;
    font-size: 27px;
  }
  .app-state p {
    margin: 0;
    color: #9da2a7;
    line-height: 1.5;
  }
  .error-mark {
    display: grid;
    place-items: center;
    width: 42px;
    height: 42px;
    border: 2px solid #b8bdc2;
    border-radius: 50%;
    color: #e8eaec;
    font-weight: 800;
    font-size: 25px;
  }
  .app-error pre {
    width: 100%;
    max-height: 180px;
    overflow: auto;
    margin: 24px 0 0;
    padding: 14px;
    border: 1px solid #41454a;
    border-radius: 7px;
    background: #111214;
    color: #c6cacf;
    font:
      12px/1.5 ui-monospace,
      monospace;
    text-align: left;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    user-select: text;
  }
  .state-actions {
    display: flex;
    justify-content: center;
    gap: 10px;
    margin-top: 18px;
  }
  .state-actions button {
    min-width: 120px;
    min-height: 44px;
    padding: 0 16px;
    border: 1px solid #53585e;
    border-radius: 7px;
    background: #2a2d31;
    cursor: pointer;
  }
  .state-actions button.primary {
    background: #d1d4d7;
    color: #17191b;
    border-color: #d1d4d7;
    font-weight: 700;
  }
</style>
