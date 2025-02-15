<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { supabase } from "$lib/supabaseClient";
  import {fetchCurrentGameId,
          fetchResponsesForGame,
          subscribeToVotes,
          voteForResponse ,  
          calculateGameScores, 
          checkAllVoted
        } from "$lib/api";

  import { goto } from '$app/navigation';
  
  let responses = [];
  let userId = null;
  let gameId = null;
  let hasVoted = false; // Tracks if user has voted

  
  async function fetchResponses() {
    if (!gameId) return;
    const data = await fetchResponsesForGame(gameId);
    responses = data || [];
  }

  async function checkIfUserVoted() {
    if (!userId || !gameId) return;
    const { data, error } = await supabase
      .from("votes")
      .select("id")
      .eq("user_id", userId)
      .eq("game_id", gameId)
      .maybeSingle();
    hasVoted = !error && !!data;
  }
  async function handleVote(responseId: number) {
    if (hasVoted) return; //Prevents double voting
    try { 
      const result = await voteForResponse(responseId, userId, gameId);
      hasVoted = true;

      if (result?.allVoted) {
        const scoreResult = await calculateGameScores(gameId);
        // Debug log: show which player's score was updated and by how many points.
        console.log(`Score updated for player ${scoreResult.winningPlayer}: +${scoreResult.points} points`);
        goto('/winner');
      } 

    } catch (error) {
      console.error("Error voting:", error);
    }
  }

  function setupRealtimeSubscription() {
    // Subscribe to votes table changes for this game
    votesSubscription = supabase
      .channel("game-votes")
      .on(
        "postgres_changes",
        {
          event: "*", // Listen for all changes
          schema: "public",
          table: "votes",
          filter: `game_id=eq.${gameId}`,
        },
        () => {
          // Refresh responses when any vote changes
          fetchResponses();
        }
      )
      .on(
        "postgres_changes",
                {
                event: "*", // Listen for all changes
                schema: "public",
                table: "responses",
                filter: `game_id=eq.${gameId}`,
                },
                () => {
                // Refresh responses when any vote changes
                fetchResponses();
                }

      )
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
    userId = sessionData?.session?.user?.id || null;

    const { data: latestGame, error: gameError } = await supabase
      .from("game")
      .select("id")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (!gameError && latestGame) {
      gameId = await fetchCurrentGameId();  
      await fetchResponses();
      await checkIfUserVoted();

       // Use subscribeToVotes for real-time updates
      const unsubscribe = subscribeToVotes(gameId, async (updatedResponses) => {
        responses = updatedResponses;

      const allVoted = await checkAllVoted(gameId);
      if (allVoted) {
        const scoreResult = await calculateGameScores(gameId);
        // Debug log: show which player's score was updated and by how many points.
        console.log(`Score updated for player ${scoreResult.winningPlayer}: +${scoreResult.points} points`);
        goto('/winner');
      }
        
    });
      // Cleanup subscription when component is destroyed
      onDestroy(unsubscribe);
    } else {
      console.error("Error fetching current game:", gameError);
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
