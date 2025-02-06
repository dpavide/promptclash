<script>
    import { onMount, onDestroy } from 'svelte';
    import { supabase } from '$lib/supabaseClient';
    import { voteForResponse } from '$lib/api';

    let responses = [];
    let userId = null;
    let gameId = null;
    let hasVoted = false; // Tracks if user has voted
    let votesSubscription = null; // Store our realtime subscription

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

    async function checkIfUserVoted() {
        if (!userId || !gameId) return;

        const { data, error } = await supabase
            .from('votes')
            .select('id')
            .eq('user_id', userId)
            .eq('game_id', gameId)
            .maybeSingle();

        hasVoted = !error && !!data;
    }

    async function handleVote(responseId) {
        if (hasVoted) return;

        try {
            await voteForResponse(responseId, userId, gameId);
            hasVoted = true;
        } catch (error) {
            console.error('Error voting:', error);
        }
    }

    function setupRealtimeSubscription() {
        // Subscribe to votes table changes for this game
        votesSubscription = supabase
            .channel('game-votes')
            .on('postgres_changes', {
                event: '*', // Listen for all changes
                schema: 'public',
                table: 'votes',
                filter: `game_id=eq.${gameId}`
            }, () => {
                // Refresh responses when any vote changes
                fetchResponses();
            })
            .subscribe();

        // Return cleanup function
        return () => {
            if (votesSubscription) {
                supabase.removeChannel(votesSubscription);
            }
        };
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
            await checkIfUserVoted();
            const cleanup = setupRealtimeSubscription();
            
            // Cleanup subscription when component is destroyed
            onDestroy(cleanup);
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
                <button on:click={() => handleVote(response.id)}>Vote</button>
            </li>
        {/each}
    </ul>
{:else}
    <ul>
        {#each responses as response}
            <li>
                <p>{response.response}</p>
                <p>Votes: {response.vote_count || 0}</p>
            </li>
        {/each}
    </ul>
{/if}