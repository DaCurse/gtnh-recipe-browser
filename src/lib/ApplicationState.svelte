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

<style>
  .state-main { grid-template-columns:1fr; place-items:center; overflow:auto; padding:28px; }
  .app-state { width:min(620px,100%); display:flex; flex-direction:column; align-items:center; padding:52px 34px; border:1px solid #3c4044; border-radius:14px; background:#1b1d20; box-shadow:0 24px 80px #0007; text-align:center; }
  .app-state h1 { margin:22px 0 8px; font-size:27px; }
  .app-state p { margin:0; color:#9da2a7; line-height:1.5; }
  .app-state>small { margin-top:8px; color:#8e9398; font:12px ui-monospace,monospace; }
  .error-mark { display:grid; place-items:center; width:42px; height:42px; border:2px solid #b8bdc2; border-radius:50%; color:#e8eaec; font-weight:800; font-size:25px; }
  .app-error pre { width:100%; max-height:180px; overflow:auto; margin:24px 0 0; padding:14px; border:1px solid #41454a; border-radius:7px; background:#111214; color:#c6cacf; font:12px/1.5 ui-monospace,monospace; text-align:left; white-space:pre-wrap; overflow-wrap:anywhere; user-select:text; }
  .state-actions { display:flex; justify-content:center; gap:10px; margin-top:18px; }
  .state-actions button { min-width:120px; min-height:44px; padding:0 16px; border:1px solid #53585e; border-radius:7px; background:#2a2d31; cursor:pointer; }
  .state-actions button.primary { background:#d1d4d7; color:#17191b; border-color:#d1d4d7; font-weight:700; }
</style>
