<script>
	import { supabase } from '$lib/supabaseClient';
	import { addUserToLatestGame } from '$lib/api';
	import { goto } from '$app/navigation';

	let username = '';

	async function handleAnonymousSignIn() {
		if (!username) {
			alert('Please enter a username');
			return;
		}

		// Perform anonymous sign-in
		const { data, error } = await supabase.auth.signInAnonymously();

		if (error) {
			console.error('Error during anonymous sign-in:', error);
			alert('Failed to sign in. Please try again.');
			return;
		}

		try {
			// Add the user to the latest game
			await addUserToLatestGame(username, data.user);
			alert('You have joined the game');
			goto(`/waitingroom`);
		} catch (addError) {
			console.error('Error:', addError);
			alert('Failed to join the game. Please try again.');
		}
	}
</script>


<form on:submit|preventDefault={handleAnonymousSignIn}>
	<input type="text" bind:value={username} placeholder="username">
	<button type="submit">join</button>
</form>
