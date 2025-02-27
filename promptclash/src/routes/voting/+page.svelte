<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { supabase } from "$lib/supabaseClient";
  import {
    fetchResponsesForGame,
    subscribeToVotes,
    voteForResponse,
    calculateGameScores,
    checkAllVoted,
  } from "$lib/api";
  import { goto } from "$app/navigation";

  let responses = [];
  let userId = null;
  let gameId = null;
  let hasVoted = false; // Tracks if user has voted
  let subscription; // Stores the subscription for cleanup

  async function fetchResponses() {
    if (!gameId) return;
    const data = await fetchResponsesForGame(gameId);
    responses =
      data.map((r) => ({
        ...r,
        response:
          r.response?.trim().length > 0 ? r.response : "{no response given}",
      })) || [];
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
    if (hasVoted) return; // Prevents double voting
    try {
      const result = await voteForResponse(responseId, userId, gameId);
      hasVoted = true;

      if (result?.allVoted) {
        await calculateGameScores(gameId);
        goto(`/winner?gameId=${gameId}`);
      }
    } catch (error) {
      console.error("Error voting:", error);
    }
  }

  onMount(async () => {
    // Get user info
    const { data: sessionData } = await supabase.auth.getSession();
    userId = sessionData?.session?.user?.id || null;

    // Get gameId from URL query parameters
    const urlParams = new URLSearchParams(window.location.search);
    const gameIdParameter = urlParams.get("gameId");
    if (!gameIdParameter) {
      alert("Game ID not specified.");
      goto("/waitingroom");
      return;
    }
    gameId = Number(gameIdParameter);

    await fetchResponses();
    await checkIfUserVoted();

    // Subscribe to votes
    subscription = subscribeToVotes(gameId, async (updatedResponses) => {
      responses = updatedResponses.map((r) => ({
        ...r,
        response:
          r.response?.trim().length > 0 ? r.response : "{no response given}",
      }));

      // Check if all players have voted
      const allVoted = await checkAllVoted(gameId);
      if (allVoted) {
        await calculateGameScores(gameId);
        goto(`/winner?gameId=${gameId}`);
      }
    });
  });

  onDestroy(() => {
    if (subscription && typeof subscription.unsubscribe === "function") {
      subscription.unsubscribe();
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
