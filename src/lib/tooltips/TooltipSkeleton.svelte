<div
  class="minecraft-tooltip tooltip-skeleton"
  role="status"
  aria-label="Loading item information"
  aria-busy="true"
>
  <div aria-hidden="true">
    <span class="heading"></span>
    <span class="identifier"></span>
    <span></span>
    <span class="short"></span>
    <span class="mod"></span>
  </div>
</div>

<style>
  .tooltip-skeleton {
    min-height: 146px;
    padding: 12px;
  }
  span {
    display: block;
    width: 82%;
    height: 14px;
    margin-bottom: 10px;
    background: linear-gradient(90deg, #baa0ca25 25%, #dec5ee45 50%, #baa0ca25 75%);
    background-size: 200% 100%;
    animation: shimmer 1.6s ease-in-out infinite;
  }
  .heading {
    width: 60%;
    height: 18px;
  }
  .identifier {
    width: 72%;
    height: 8px;
    margin-bottom: 18px;
  }
  .short {
    width: 65%;
  }
  .mod {
    width: 28%;
    margin: 14px 0 0;
  }
  @keyframes shimmer {
    to {
      background-position: -200% 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    span {
      animation: none;
    }
  }
</style>
