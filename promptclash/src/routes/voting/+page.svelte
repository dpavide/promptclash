<script>
    import { fetchCurrentGameId, fetchResponsesForGame, voteForResponse, subscribeToVotes } from '$lib/api';
    import { onMount } from 'svelte';

    let responses = [];
    let gameId = null; // Initially null, will be set dynamically
    let unsubscribe;

    // Load responses for the current game
    async function loadResponses() {
        if (!gameId) {
            console.error('Game ID is not set.');
            return;
        }

        try {
            responses = await fetchResponsesForGame(gameId);
        } catch (error) {
            console.error('Error loading responses:', error);
        }
    }

    // Handle voting for a response
    async function handleVote(responseId) {
        try {
            await voteForResponse(responseId);
        } catch (error) {
            console.error('Error voting for response:', error);
        }
    }

    // Update responses dynamically when votes change
    function updateVotes(updatedResponse) {
        const index = responses.findIndex((r) => r.id === updatedResponse.id);
        if (index !== -1) {
            responses[index] = updatedResponse;
        }
    }

    onMount(async () => {
        try {
            // Fetch the current game ID dynamically
            gameId = await fetchCurrentGameId();
            console.log('Current Game ID:', gameId);

            // Load responses for the game
            await loadResponses();

            // Subscribe to real-time updates
            unsubscribe = subscribeToVotes(gameId, updateVotes);
        } catch (error) {
            console.error('Error initializing voting page:', error);
        }

        return () => {
            // Clean up subscription
            if (unsubscribe) unsubscribe();
        };
    });
</script>

<h1>Voting Page</h1>
{#if responses.length > 0}
    <ul>
        {#each responses as response}
            <li>
                <p>{response.text}</p>
                <p>Votes: {response.votes}</p>
                <button on:click={() => handleVote(response.id)}>Vote</button>
            </li>
        {/each}
    </ul>
{:else}
    <p>Loading responses...</p>
{/if}
