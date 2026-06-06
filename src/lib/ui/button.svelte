<script lang="ts">
  import { cn } from '$lib/utils';

  export let className = '';
  export let type: 'button' | 'submit' | 'reset' = 'button';
</script>

<button
  {type}
  class={cn(
    'inline-flex items-center justify-center rounded-full bg-stone-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-stone-800 focus:outline-none focus:ring-2 focus:ring-stone-900/30 focus:ring-offset-2',
    className
  )}
>
  <slot />
</button>