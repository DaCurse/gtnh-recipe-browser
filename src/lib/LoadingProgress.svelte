<script lang="ts">
  let {
    title,
    detail,
    progress,
    label,
  }: {
    title: string;
    detail?: string;
    progress: number;
    label: string;
  } = $props();
</script>

<div class="loading-progress" role="status" aria-live="polite">
  <h1>{title}</h1>
  {#if detail}<p>{detail}</p>{/if}
  <div
    class="load-progress"
    role="progressbar"
    aria-label={label}
    aria-valuemin="0"
    aria-valuemax="100"
    aria-valuenow={progress}
  >
    <span style:width={`${progress}%`}></span>
  </div>
</div>

<style>
  .loading-progress {
    width: min(420px, 100%);
    margin: auto;
    padding: 30px;
    text-align: center;
  }
  h1 {
    margin: 0 0 16px;
    font:
      400 20px/28px Minecraft,
      monospace;
    text-shadow: 2px 2px #222;
  }
  p {
    margin: -5px 0 16px;
    color: #8c949f;
    font:
      400 12px/18px ui-sans-serif,
      system-ui,
      sans-serif;
  }
  .load-progress {
    margin-left: auto;
    margin-right: auto;
  }
</style>
