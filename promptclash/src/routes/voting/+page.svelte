<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { supabase } from "$lib/supabaseClient";
  import {
    fetchResponsesForGame,
    voteForResponse,
    checkAllVotedForPrompt,
  } from "$lib/api";
  import { goto } from "$app/navigation";

  let userId = "";
  let gameId = 0;
  let promptIndex: number = 0;
  let currentPrompt: any = null;

  let responses: Array<{
    id: number;
    text: string;
    player_id: string;
    vote_count: number;
  }> = [];

  let errorMessage = "";
  let responderIDs = new Set<string>();
  let playersWhoCanVote = 0;
  let playersCount = 0;
  let hasVoted = false;
  let votesSubscription: any = null;

  async function fetchPlayerCount() {
    const { data, error } = await supabase
      .from("profiles")
      .select("id")
      .eq("game_id", gameId);
    if (error || !data) {
      console.error("Error fetching players count:", error);
      return;
    }
    playersCount = data.length;
    playersWhoCanVote = playersCount - 2;
  }

  async function fetchCurrentPrompt() {
    const { data: promptsList, error } = await supabase
      .from("prompts")
      .select("id, text, player_id")
      .eq("game_id", gameId)
      .order("id", { ascending: true });

    if (error || !promptsList || promptsList.length === 0) {
      errorMessage = "No prompts found for this game.";
      return false;
    }
    if (promptIndex >= promptsList.length) {
      goto(`/winner?gameId=${gameId}&final=true`);
      return false;
    }
    currentPrompt = promptsList[promptIndex];
    return true;
  }

  function setupRealtimeSubscriptions() {
    votesSubscription = supabase
      .channel("game-votes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "votes",
          filter: `game_id=eq.${gameId}`,
        },
        async () => {
          await refreshVoteCounts();
          const allVoted = await checkAllVotedForPrompt(
            gameId,
            currentPrompt.id,
            playersWhoCanVote
          );
          if (allVoted) {
            goto(`/winner?gameId=${gameId}&promptIndex=${promptIndex}`);
          }
        }
      )
      .subscribe();

    return () => {
      if (votesSubscription) {
        supabase.removeChannel(votesSubscription);
      }
    };
  }

  async function fetchCurrentResponses() {
    if (!currentPrompt) return;
    const { data: responsesData, error } = await supabase
      .from("responses")
      .select("id, text, player_id")
      .eq("game_id", gameId)
      .eq("prompt_id", currentPrompt.id);

    if (error || !responsesData || responsesData.length < 2) {
      errorMessage = "Not enough responses for this prompt.";
      return;
    }

    responderIDs = new Set(responsesData.map((r) => r.player_id));
    responses = responsesData.map((r) => ({
      id: r.id,
      text: r.text?.trim() || "{no response given}",
      player_id: r.player_id,
      vote_count: 0,
    }));

    await refreshVoteCounts();
  }

  async function refreshVoteCounts() {
    if (!currentPrompt) return;
    const { data: allVotes, error } = await supabase
      .from("votes")
      .select("response_id")
      .eq("game_id", gameId)
      .eq("prompt_id", currentPrompt.id);

    if (error || !allVotes) return;

    const counts: Record<number, number> = {};
    for (const v of allVotes) {
      counts[v.response_id] = (counts[v.response_id] || 0) + 1;
    }

    responses = responses.map((r) => ({
      ...r,
      vote_count: counts[r.id] || 0,
    }));
  }

  async function handleVote(responseId: number, responsePlayerId: string) {
    if (responderIDs.has(userId)) {
      alert("You can't vote for your own response!");
      return;
    }
    if (responsePlayerId === userId) {
      alert("You cannot vote on your own response. Stop trying bruh 💀");
      return;
    }
    if (hasVoted) {
      alert("You have already voted!");
      return;
    }
    try {
      const voteResult = await voteForResponse(
        responseId,
        userId,
        gameId,
        currentPrompt.id
      );
      if (voteResult?.error) {
        errorMessage = "Failed to submit vote.";
        return;
      }
      hasVoted = true;
      await refreshVoteCounts();
      const allVoted = await checkAllVotedForPrompt(
        gameId,
        currentPrompt.id,
        playersWhoCanVote
      );
      if (allVoted) {
        goto(`/winner?gameId=${gameId}&promptIndex=${promptIndex}`);
      }
    } catch (error) {
      console.error("Error voting:", error);
      errorMessage = "Failed to submit vote.";
    }
  }

  onMount(async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const gameIdParam = urlParams.get("gameId");
    const promptIndexParam = urlParams.get("promptIndex");

    if (!gameIdParam) {
      alert("Game ID not specified.");
      goto("/waitingroom");
      return;
    }

    const { data: sessionData } = await supabase.auth.getSession();
    userId = sessionData?.session?.user?.id || "";
    gameId = Number(gameIdParam);
    promptIndex = promptIndexParam ? Number(promptIndexParam) : 0;

    await fetchPlayerCount();
    const ok = await fetchCurrentPrompt();
    if (!ok || !currentPrompt) return;

    await fetchCurrentResponses();

    const cleanup = setupRealtimeSubscriptions();

    onDestroy(() => {
      if (cleanup) cleanup();
    });
  });
</script>

<div class="page-container">
  <div class="frame">
    <h1>Voting on Prompt #{promptIndex + 1}</h1>

    {#if currentPrompt}
      <p><strong>Prompt:</strong> {currentPrompt.text}</p>

      {#each responses as r (r.id)}
        <div style="margin-bottom: 1rem;">
          <p>{r.text}</p>
          <p>Votes: {r.vote_count}</p>

          {#if responderIDs.has(userId)}
            <p style="color: gray;">(You are a responder; no voting)</p>
          {:else if r.player_id === userId}
            <p style="color: gray;">(Your own response)</p>
          {:else if hasVoted}
            <p style="color: gray;">(You already voted!)</p>
          {:else}
            <button on:click={() => handleVote(r.id, r.player_id)}>Vote</button>
          {/if}
        </div>
      {/each}
    {:else}
      <p>Loading prompt...</p>
    {/if}

    {#if errorMessage}
      <p style="color: red;">{errorMessage}</p>
    {/if}
  </div>
</div>

<style>
  .page-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100vh;
  }

  .frame {
    --frame-scale: 1.2;
    --base-offset: 50px;
    display: flex;
    flex-direction: row;
    width: 95vw;
    max-width: 1200px;
    aspect-ratio: 2 / 1;
    position: relative;
    background-image: url("backgrounds/bg1.png");
    background-size: contain;
    background-repeat: no-repeat;
    background-position: center;
    animation: bgAnimation 1.5s infinite;
    justify-content: space-around;
    align-items: center;
    transform: scale(var(--frame-scale));
    margin-bottom: 10px;
    padding: 1rem;
  }
  .frame > * {
    transform: translateY(calc(-1 * var(--base-offset) * var(--frame-scale)));
  }

  @keyframes bgAnimation {
    0% {
      background-image: url("backgrounds/bg1.png");
    }
    33% {
      background-image: url("backgrounds/bg2.png");
    }
    66% {
      background-image: url("backgrounds/bg3.png");
    }
    100% {
      background-image: url("backgrounds/bg1.png");
    }
  }
</style>
