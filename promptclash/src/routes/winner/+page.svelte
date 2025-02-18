<script lang="ts">
    import { onMount } from 'svelte';
    import { supabase } from '$lib/supabaseClient';
    import { fetchCurrentGameId, calculateGameScores, fetchWinningResponse } from '$lib/api';

    let losingResponse =  null;
    let winningResponse = null;
    let tie = false;
    let tiePlayers = [];
    let winningPlayer =  null;
    let winningUsername = null;
    let points = 0;
    let maxVotes = 0;

    onMount(async () => { 
        try {  
            const gameId = await fetchCurrentGameId();
            const result = await calculateGameScores(gameId);
            if (result.tie) {
        // Draw scenario
        tie = true;
        tiePlayers = result.players; // each has {playerId, username, votes, points, responses}
      } else {
        // Normal scenario
        tie = false;
        const winningResult = await fetchWinningResponse(gameId);
        if (winningResult){
            winningResponse = winningResult.winningResponse;
            losingResponse = winningResult.losingResponse;
        }
      }
    } catch (err) {
      console.error("Error in winner page:", err);
    }
  });   
</script>

<h1>Winner</h1>

{#if tie}
  <h2>This round's a draw!</h2>
  {#each tiePlayers as player}
    <div style="margin-bottom: 1rem;">
      <p><strong>{player.username}</strong> had {player.votes} total votes</p>
      <p>Points Earned: {player.points}</p>
      <!-- Display both responses -->
      {#each player.responses as r}
        <p>Response: {r.text} (Votes: {r.votes})</p>
      {/each}
    </div>
  {/each}
{:else}
  <!-- Normal winner scenario -->
  {#if winningResponse && losingResponse}
    <div>
    <p><strong>{winningResponse.username}</strong>wins this round, with response:</p>
    <h2>{winningResponse.response}</h2>
    <p>Votes: {winningResponse.vote_count}</p>
    <p>Points Earned: {winningResponse.pointsEarned}</p>
    </div>
    <div style="margin-top: 2rem;">
    <h2>Losing Response</h2>
    <p>{losingResponse.response}</p>
    <p>Votes: {losingResponse.vote_count}</p>
    <p>Submitted by: <strong>{losingResponse.username}</strong></p>
    <!-- Losing response points: each vote counts for 100 points -->
    <p>Points Earned: {losingResponse.vote_count * 100}</p>
    </div>
  {:else}
    <p>Loading winner...</p>
  {/if}
{/if}
