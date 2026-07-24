<script lang="ts">
  let {
    status,
    stage,
    progress,
    error,
    errorCopied,
    retry,
    copyError
  }: {
    status: 'loading' | 'error';
    stage: string;
    progress: number;
    error: string;
    errorCopied: boolean;
    retry: () => void;
    copyError: () => void;
  } = $props();
</script>

<main class="state-main">
  {#if status === 'loading'}
    <section class="app-state" aria-live="polite">
      <span class="spinner" aria-hidden="true"></span>
      <h1>Loading GTNH catalog</h1>
      <p>{stage}</p>
      <div class="load-progress" aria-label={`Catalog loading ${progress}%`}>
        <span style:width={`${progress}%`}></span>
      </div>
      <small>{progress}%</small>
    </section>
  {:else}
    <section class="app-state app-error" aria-live="assertive">
      <span class="error-mark" aria-hidden="true">!</span>
      <h1>Catalog failed to load</h1>
      <p>The browser could not verify or open the active GTNH dataset.</p>
      <pre>{error}</pre>
      <div class="state-actions">
        <button onclick={copyError}>{errorCopied ? 'Copied' : 'Copy error'}</button>
        <button class="primary" onclick={retry}>Try again</button>
      </div>
    </section>
  {/if}
</main>
