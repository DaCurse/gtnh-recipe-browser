<script lang="ts">
  let { href, label, shortLabel, icon, primary = false, undiscovered = false, active = false, onclick }: {
    href: string; label: string; shortLabel?: string; icon?: string; primary?: boolean; undiscovered?: boolean; active?: boolean; onclick: () => void;
  } = $props();
</script>
<a class="mc-button feature-link" class:primary {href} aria-label={label} aria-current={active ? 'page' : undefined} title={undiscovered ? 'New feature' : undefined}
  onclick={event => { event.preventDefault(); onclick(); }}>
  {#if icon}<img src={icon} alt="" width="24" height="24" />{/if}<span class:full-label={Boolean(shortLabel)}>{label}</span>{#if shortLabel}<span class="short-label" aria-hidden="true">{shortLabel}</span>{/if}{#if undiscovered}<span class="feature-blip" aria-hidden="true" title="New"></span>{/if}
</a>
<style>
  .feature-link { position:relative; }
  .short-label { display:none; }
  img { flex:none; image-rendering:pixelated; }
  @media(max-width:800px) { img { width:16px; height:16px; } }
  @media(max-width:800px) { .full-label { display:none; } .short-label { display:inline; } }
  .feature-blip { position:absolute; top:5px; right:5px; width:6px; height:6px; border-radius:50%; background:#b7a672; opacity:.65; box-shadow:0 0 7px #b7a64266; pointer-events:none; }
</style>
