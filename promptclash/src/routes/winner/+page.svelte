<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { goto } from "$app/navigation";
  import { supabase } from "$lib/supabaseClient";
  import {
    fetchAllPlayersScores,
    calculatePromptScores,
  } from "$lib/api";

  let gameId: number;
  let promptIndex: number = 0;
  let finalMode: boolean = false;
  let finalScores: any[] = [];

  let currentPrompt: any = null;
  let errorMessage = "";
  let subscription: any;
  let result: any = null; 

  let promptAuthorName = "";
  let responderA: any = null;
  let responderB: any = null;

  onMount(async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const param = urlParams.get("gameId");
    const index = urlParams.get("promptIndex");
    const finalParam = urlParams.get("final");

    if (!param) {
      alert("No game ID found.");
      goto("/waitingroom");
      return;
    }
    gameId = Number(param);
    promptIndex = index ? Number(index) : 0;
    finalMode = (finalParam === "true");

    subscription = supabase
      .channel("game-changes")
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "game",
          filter: `id=eq.${gameId}`
        },
        (payload) => {
          const newIndex = payload.new.current_prompt_index;
          if (newIndex !== promptIndex) {
            goto(`/voting?gameId=${gameId}&promptIndex=${newIndex}`);
          }
        }
      )
      .subscribe();

    if (finalMode) {
      finalScores = await fetchAllPlayersScores(gameId);
      return;
    }

    // Fetch all prompts for this game (sorted by id)
    const { data: prompts, error: promptErr } = await supabase
      .from("prompts")
      .select("id, text, player_id")
      .eq("game_id", gameId)
      .order("id", { ascending: true });

    if (promptErr || !prompts || prompts.length === 0) {
      errorMessage = "Failed to fetch prompts.";
      return;
    }

    if (promptIndex >= prompts.length) {
      // No more prompts; show final scoreboard
      goto(`/winner?gameId=${gameId}&final=true`);
      return;
    }

    currentPrompt = prompts[promptIndex];

    // fetch the prompt's author
    if (currentPrompt?.player_id) {
      const { data: authorProfile } = await supabase
        .from("profiles")
        .select("username")
        .eq("id", currentPrompt.player_id)
        .single();
      promptAuthorName = authorProfile?.username || "Unknown";
    }

    // do the final scoring for this prompt
    const res = await calculatePromptScores(gameId, currentPrompt.id);
    if (res.error) {
      errorMessage = res.error;
      return;
    }
    result = res;

    // if tie => we have respA & respB
    // if not tie => we have winner & loser
    if (result.tie) {
      // fetch their names from profiles
      responderA = await fetchResponderInfo(result.respA);
      responderB = await fetchResponderInfo(result.respB);
    } else {
      responderA = await fetchResponderInfo(result.winner);
      responderB = await fetchResponderInfo(result.loser);
    }
  });

  onDestroy(() => {
    if (subscription && typeof subscription.unsubscribe === "function") {
      subscription.unsubscribe();
    }
  });

  function subscribeToGameChanges() {
    subscription = supabase
      .channel("game-changes")
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "game",
          filter: `id=eq.${gameId}`
        },
        (payload) => {
          const newIndex = payload.new.current_prompt_index;
          if (newIndex !== promptIndex) {
            // universal redirect
            goto(`/voting?gameId=${gameId}&promptIndex=${newIndex}`);
          }
        }
      )
      .subscribe();
  }

  // fetch a single responder's username
  async function fetchResponderInfo(respObj) {
    if (!respObj?.player_id) {
      return {
        username: "Unknown",
        vote_count: respObj?.vote_count || 0,
      };
    }
    const { data: p } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", respObj.player_id)
      .single();
    return {
      username: p?.username || "Unknown",
      vote_count: respObj.vote_count || 0,
    };
  }

  async function nextPrompt() {
    const newIndex = promptIndex + 1;
    const { error } = await supabase
      .from("game")
      .update({ current_prompt_index: newIndex })
      .eq("id", gameId);

    if (error) {
      console.error("Error updating next prompt index:", error);
    }
  }
</script>

{#if finalMode}
  <h1>Final Scoreboard</h1>
  {#if errorMessage}
    <p style="color: red;">{errorMessage}</p>
  {/if}
  <ol>
    {#each finalScores as player}
      <li><strong>{player.username}</strong>: {player.score} points</li>
    {/each}
  </ol>
{:else if currentPrompt}
  <h1>Results for Prompt #{promptIndex + 1}</h1>
  <h2>"{currentPrompt.text}"</h2>
  <p>Prompt Author: <strong>{promptAuthorName}</strong></p>
  {#if errorMessage}
    <p style="color: red;">{errorMessage}</p>
  {/if}

  {#if result}
    {#if result.tie}
      <p>It's a tie!</p>
      <p>
        <strong>{responderA?.username}</strong> got {responderA?.vote_count} votes,
        and <strong>{responderB?.username}</strong> got {responderB?.vote_count} votes.
      </p>
      <p>No bonus points awarded in a tie.</p>
    {:else}
      <p>
        <strong>Winner:</strong> {responderA?.username} with {responderA?.vote_count} votes
      </p>
      <p>
        <strong>Loser:</strong> {responderB?.username} with {responderB?.vote_count} votes
      </p>
      <p>Bonus Points Awarded: {result.bonusPoints}</p>
    {/if}

    <button on:click={nextPrompt}>Next Prompt</button>
  {:else}
    <p>Loading results...</p>
  {/if}
{:else}
  <p>Loading prompt info...</p>
{/if}

<style>
  h1,
  h2 {
    text-align: center;
  }
  ol {
    list-style-type: decimal;
  }
  button {
    padding: 10px 20px;
    margin-top: 20px;
    cursor: pointer;
  }
</style>