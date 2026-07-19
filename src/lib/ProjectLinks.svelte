<script lang="ts">
  let { variant = '' }: { variant?: string } = $props();
</script>

<nav class={`project-links ${variant}`} aria-label="Project links">
  <a
    href="https://github.com/DaCurse/gtnh-recipe-browser"
    target="_blank"
    rel="noreferrer"
    aria-label="GTNH Recipe Browser source code on GitHub"
  >
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 .8a11.4 11.4 0 0 0-3.6 22.2c.6.1.8-.2.8-.6v-2.2c-3.3.7-4-1.4-4-1.4-.5-1.4-1.3-1.7-1.3-1.7-1.1-.8.1-.8.1-.8 1.2.1 1.8 1.2 1.8 1.2 1.1 1.9 2.8 1.4 3.5 1.1.1-.8.4-1.4.8-1.7-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.6.1-3.2 0 0 1-.3 3.3 1.2a11.2 11.2 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.6.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .4.2.7.8.6A11.4 11.4 0 0 0 12 .8Z"></path>
    </svg>
    GitHub
  </a>
  <a
    href="https://github.com/ShadowTheAge/gtnh/"
    target="_blank"
    rel="noreferrer"
  >Thanks to ShadowTheAge</a>
</nav>
