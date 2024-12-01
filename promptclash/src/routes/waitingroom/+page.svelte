<script>
    import { supabase } from '$lib/supabaseClient';
    import { monitorPlayerCount } from '$lib/api';
    import { goto } from '$app/navigation';
    import { onMount } from 'svelte';

    let currentGame;
    let playerCount = 0;
    let unsubscribe;

    // Fetch the most recent game
    async function fetchLatestGame() {
        const { data: latestGame, error } = await supabase
            .from('game')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (error) {
            console.error('Error fetching the latest game:', error);
            throw error;
        }

        return latestGame;
    }

    // Monitor player count for the latest game
    async function setupPlayerCountMonitoring() {
        try {
            currentGame = await fetchLatestGame();
            console.log('Current game:', currentGame);

            // Fetch the initial player count
            const { data: players, error } = await supabase
                .from('profiles')
                .select('*')
                .eq('game_id', currentGame.id);

            if (error) {
                console.error('Error fetching initial players:', error);
                return;
            }

            playerCount = players.length; // Update playerCount dynamically
            console.log(`Initial players in game ${currentGame.id}:`, playerCount);

            // Subscribe to changes in player count
            unsubscribe = monitorPlayerCount(currentGame.id, () => {
                // Redirect to the active game page when ready
                goto('/game');
            }, (newCount) => {
                // Update playerCount when a new player joins
                playerCount = newCount;
            });
        } catch (error) {
            console.error('Error setting up player count monitoring:', error);
        }
    }

    onMount(() => {
        setupPlayerCountMonitoring();

        return () => {
            if (unsubscribe) unsubscribe();
        };
    });
</script>

<h1>Waiting Room</h1>
<p>Waiting for players to join the game...</p>
<p>Current players: {playerCount}</p>
