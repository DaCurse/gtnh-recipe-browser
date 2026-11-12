<!-- PanelTaskLocation draws this compass with lines and text, rather than a texture.
     There is no player position in the browser, so use its unknown-location marker. -->
<span class="location-map" role="img" aria-label="Location map">
  <span class="map-face"></span>
  <span class="north">N</span><span class="south">S</span><span class="east">E</span><span class="west">W</span>
  <span class="unknown">?</span>
</span>
<style>
  .location-map { position:relative; display:inline-block; flex:none; width:48px; height:48px; font:700 8px/8px Minecraft,monospace; color:#fff; text-shadow:none; }
  .map-face { position:absolute; inset:7px; border:1px solid #fff; background:#000; }
  .north,.south { position:absolute; left:50%; transform:translateX(-50%); }
  .north { top:0; } .south { bottom:0; }
  .east,.west { position:absolute; top:50%; transform:translateY(-50%); }
  .east { right:0; } .west { left:0; }
  .unknown { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); color:#f00; font-size:16px; line-height:16px; }
</style>
