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
  <div class="voting-header">
    <h1>Voting on Prompt #{promptIndex + 1}</h1>
  </div>

  <div class="background-container">
    <div class="animated-background"></div>
    <div class="prompt-wrapper">
      {#if currentPrompt}
        <div class="prompt-content">
          <p class="prompt-text">
            <strong>Prompt:</strong>
            {currentPrompt.text}
          </p>

          <div class="responses-container">
            {#each responses as r (r.id)}
              <div class="response-card">
                <p class="response-text">{r.text}</p>
                <p class="vote-count">Votes: {r.vote_count}</p>

                {#if responderIDs.has(userId)}
                  <p class="voter-status">(You answered this prompt, so you can't vote)</p>
                {:else if r.player_id === userId}
                  <p class="voter-status">(Your own response)</p>
                {:else if hasVoted}
                  <p class="voter-status">(You already voted!)</p>
                {:else}
                  <button
                    class="vote-button"
                    on:click={() => handleVote(r.id, r.player_id)}
                  >
                    Vote
                  </button>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      {:else}
        <p class="loading">Loading prompt...</p>
      {/if}

      {#if errorMessage}
        <p class="error-message">{errorMessage}</p>
      {/if}
    </div>
  </div>
</div>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
  }

  .page-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    min-height: 100vh;
    background-color: #078fd8; /* Matching blue color */
    padding: 20px;
  }

  .background-container {
    position: relative;
    width: 100%;
    max-width: 1600px;
    margin: 0 auto;
    aspect-ratio: 1.5;
  }

  .animated-background {
    width: 100%;
    height: 100%;
    border-radius: 10px;
    background-size: contain;
    background-repeat: no-repeat;
    background-position: center;
    animation: bgAnimation 1s infinite ease-in-out;
  }

  .prompt-wrapper {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 90%;
    max-width: 1200px;
    padding: 2rem;
  }

  .voting-header {
    text-align: center;
    margin-bottom: 2rem;
    z-index: 2;
    position: relative;
  }

  .voting-header h1 {
    color: white;
    font-size: 2.5rem;
    text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.3);
  }

  .prompt-content {
    position: relative;
    z-index: 1;
  }

  .responses-container {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 1.5rem;
    padding: 4rem;
  }

  .response-card {
    background: rgba(255, 255, 255, 0.85);
    border-radius: 10px;
    padding: 1.5rem;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    backdrop-filter: blur(5px);
  }

  .prompt-text {
    color: black;
    font-size: 1.4rem;
    text-align: center;
    margin-bottom: 2rem;
    text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.2);
  }

  .response-text {
    color: #2c3e50;
    font-size: 1.1rem;
    margin-bottom: 1rem;
  }

  .vote-count {
    color: #0077cc;
    font-weight: bold;
    font-size: 1.2rem;
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

  /* Keep other existing styles from previous version */
  .voter-status {
    color: #303434;
    font-size: 0.9rem;
    margin: 0;
  }

  .vote-button {
    background-color: rgb(1, 122, 209);
    color: white;
    border: none;
    padding: 0.75rem 1.5rem;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .vote-button:hover {
    background-color: #024a7e;
    transform: translateY(-1px);
  }

  .loading {
    color: rgb(4, 0, 255);
    text-align: center;
    font-size: 1.2rem;
  }

  .error-message {
    color: #ff4444;
    text-align: center;
    font-weight: bold;
    text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.1);
  }
</style>
