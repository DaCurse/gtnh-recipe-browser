<script lang="ts">
  let { size = 48 }: { size?: number } = $props();
</script>

<span class="icon-skeleton" style:width={`${size}px`} style:height={`${size}px`} aria-hidden="true">
  <span style:width={`${Math.round(size * 0.6875)}px`} style:height={`${Math.round(size * 0.6875)}px`}></span>
</span>

<style>
  .icon-skeleton { flex-shrink:0; display:grid; place-items:center; }
  .icon-skeleton>span { border:2px solid #a5abb330; border-radius:4px; background:linear-gradient(90deg,#a5abb312 25%,#d6dbe72e 50%,#a5abb312 75%); background-size:200% 100%; animation:shimmer 1.6s ease-in-out infinite; }
  @keyframes shimmer { to { background-position:-200% 0; } }
  @media(prefers-reduced-motion:reduce) { .icon-skeleton>span { animation:none; } }
</style>
