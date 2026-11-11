<script>
  import { setupTraceway, getTraceway } from '@tracewayapp/svelte';
  import { onMount } from 'svelte';
  import { connectionString, options, mountActions } from './shared';
  setupTraceway({ connectionString, options });
  const api = getTraceway();
  onMount(() => { window.ready = true; });
</script>
<button id="checkout" on:click={mountActions(api)}>Checkout</button>
<button id="error" on:click={() => api.captureException(new Error('checkout failed'))}>Report error</button>
<input id="private"/><div id="result"></div>
