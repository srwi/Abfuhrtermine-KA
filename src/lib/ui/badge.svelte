<script lang="ts">
  import { cn } from '$lib/utils';

  export let className = '';
</script>

<span class={cn('inline-flex items-center rounded-full border border-amber-900/10 bg-white/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-amber-900', className)}>
  <slot />
</span>