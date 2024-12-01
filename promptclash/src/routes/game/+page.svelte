<script>
    import { goto } from '$app/navigation';
    import { supabase } from '$lib/supabaseClient';
    import { onMount } from 'svelte';

    let prompt = null; // The current prompt
    let response = ''; // The user's response

    onMount(async () => {
        try {
            // Fetch the prompt for the current game
            const { data: latestGame, error: gameError } = await supabase
                .from('game')
                .select('prompt_id')
                .order('created_at', { ascending: false })
                .limit(1)
                .single();

            if (gameError) {
                console.error('Error fetching the latest game:', gameError);
                return;
            }

            const { data: fetchedPrompt, error: promptError } = await supabase
                .from('prompts')
                .select('*')
                .eq('id', latestGame.prompt_id)
                .single();

            if (promptError) {
                console.error('Error fetching prompt:', promptError);
                return;
            }

            prompt = fetchedPrompt;
        } catch (error) {
            console.error('Error loading prompt:', error);
        }
    });

    async function submitResponse() {
        try {
            // Get the current user
            const { data: user, error: userError } = await supabase.auth.getUser();
            if (userError || !user) {
                console.error('No user is signed in:', userError);
                alert('You must be logged in to submit a response.');
                return;
            }

            const userId = user.user.id;
            console.log(userId)

            // Get the latest game
            const { data: latestGame, error: gameError } = await supabase
                .from('game')
                .select('id')
                .order('created_at', { ascending: false })
                .limit(1)
                .single();

            if (gameError) {
                console.error('Error fetching the latest game:', gameError);
                return;
            }

            const gameId = latestGame.id;

            // Insert the response into the responses table
            const { error: insertError } = await supabase.from('responses').insert([
                { gameid: gameId, playerid: userId, text:response }
            ]);

            if (insertError) {
                console.error('Error submitting response:', insertError);
                alert('Failed to submit response. Try again.');
            } else {
                alert('Response submitted successfully!');
                response = ''; // Clear the input field
                goto(`/voting`)
            }
        } catch (error) {
            console.error('Error in submitResponse:', error);
            alert('An error occurred. Please try again.');
        }
    }
</script>

<h1>Game</h1>
{#if prompt}
    <p>Prompt: {prompt.text}</p>
    <textarea bind:value={response} placeholder="Type your response here..."></textarea>
    <button on:click={submitResponse}>Submit</button>
{:else}
    <p>Loading prompt...</p>
{/if}
