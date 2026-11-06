<script lang="ts">
  import type { UiTexture } from './machineUi';
  import { machineUiAsset } from './machineUi';
  let { texture, x = 0, y = 0, width = '100%', height = '100%' }: {
    texture: UiTexture; x?: number; y?: number; width?: number | string; height?: number | string;
  } = $props();
  const viewBox = $derived(`${texture.uv[0] * texture.size[0]} ${texture.uv[1] * texture.size[1]} ${(texture.uv[2] - texture.uv[0]) * texture.size[0]} ${(texture.uv[3] - texture.uv[1]) * texture.size[1]}`);
</script>
<svg {x} {y} {width} {height} {viewBox} preserveAspectRatio="none" aria-hidden="true" style="overflow:hidden;image-rendering:pixelated;pointer-events:none">
  <image href={machineUiAsset(texture.file)} width={texture.size[0]} height={texture.size[1]} />
</svg>
