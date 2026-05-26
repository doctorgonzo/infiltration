<script lang="ts">
	import '../app.css';

	let { children } = $props();
</script>

<svelte:head>
	<title>INFILTRATION — Madison, WI</title>
	<meta name="description" content="Something is wrong in Madison. A d20 Modern text adventure." />
</svelte:head>

{@render children()}
