<script>
<<<<<<< Updated upstream
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
=======
    import { onMount } from 'svelte';
    import { supabase } from '$lib/supabaseClient';
    import { voteForResponse } from '$lib/api';

    let responses = [];
    let userId = null;
    let gameId = null;
    let hasVoted = false; // Track if user has already voted

    async function fetchResponses() {
        const { data, error } = await supabase
            .from('responses')
            .select(`
                id,
                text,
                votes:votes(count)
            `)
            .eq('game_id', gameId);

        if (error) {
            console.error('Error fetching responses:', error);
        } else {
            responses = data.map(response => ({
                id: response.id,
                response: response.text,
                vote_count: response.votes ? response.votes[0].count : 0
            }));
        }
    }

    let userHasVoted = new Map(); // Track votes per user

    async function checkIfUserVoted() {
        if (!userId || !gameId) return;

        const { data, error } = await supabase
            .from('votes')
            .select('id')
            .eq('user_id', userId)
            .eq('game_id', gameId)
            .maybeSingle();

        if (!error && data) {
            userHasVoted.set(userId, true); // ✅ Only store this user's vote status
        } else {
            userHasVoted.set(userId, false);
        }
    }

    async function handleVote(responseId) {
        if (hasVoted) return; // Prevent clicking again

        try {
            await voteForResponse(responseId, userId, gameId);
            hasVoted = true; // ✅ Hide buttons after voting
        } catch (error) {
            console.error('Error voting:', error);
        }
    }


    onMount(async () => {
        const { data: sessionData } = await supabase.auth.getSession();
        userId = sessionData?.session?.user?.id;

        const { data: latestGame, error: gameError } = await supabase
            .from('game')
            .select('id')
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (!gameError) {
            gameId = latestGame.id;
            await fetchResponses();
            await checkIfUserVoted(); // Check if user has already voted
        } else {
            console.error('Error fetching current game:', gameError);
        }
    });
</script>

{#if !hasVoted}
    <ul>
        {#each responses as response}
            <li>
                <p>{response.response}</p>
                <p>Votes: {response.vote_count || 0}</p>
>>>>>>> Stashed changes
                <button on:click={() => handleVote(response.id)}>Vote</button>
            </li>
        {/each}
    </ul>
{:else}
<<<<<<< Updated upstream
    <p>Loading responses...</p>
{/if}
=======
    <ul>
        {#each responses as response}
            <li>
                <p>{response.response}</p>
                <p>Votes: {response.vote_count || 0}</p>
            </li>
        {/each}
    </ul>
{/if}





>>>>>>> Stashed changes
