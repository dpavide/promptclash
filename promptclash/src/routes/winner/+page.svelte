<script lang="ts">
    import { onMount } from 'svelte';
    import { supabase } from '$lib/supabaseClient';
    import { fetchWinningResponse } from '$lib/api';

    let winningResponse = null;  
    let losingResponse = null;
    let gameId = null;
    let responses = [];

    

    onMount(async () => {
        const { data: latestGame, error: gameError } = await supabase
            .from('game')
            .select('id')
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (!gameError && latestGame) {
            gameId = latestGame.id;
            const result = await fetchWinningResponse(gameId) as { winningResponse: any; losingResponse: any } | null;
            if (result) {
            winningResponse = result.winningResponse;
            losingResponse = result.losingResponse;
        } 
        } else {
            console.error('Error fetching current game:', gameError);
        }
    });
</script>

<h1>Winner</h1>

{#if winningResponse}
    <p><strong>{winningResponse.username}</strong> wins this round, with response:</p>
    <h2>{winningResponse.response}</h2>
    <p>Votes: {winningResponse.vote_count}</p>
    <p>{winningResponse.username} points earned: {winningResponse.pointsEarned}</p>
    <p>{losingResponse.username} points earned: {losingResponse.pointsEarned}</p>
{:else}
    <p>Loading winner...</p>
{/if}
