<script lang="ts">
  import { cn } from '$lib/utils';

  export let className = '';
</script>

<div class={cn('glass-panel p-6', className)}>
  <slot />
</div>