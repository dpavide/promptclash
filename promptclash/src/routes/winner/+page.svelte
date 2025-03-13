<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { goto } from "$app/navigation";
  import { supabase } from "$lib/supabaseClient";
  import { fetchAllPlayersScores, calculatePromptScores } from "$lib/api";

  let gameId: number;
  let promptIndex: number = 0;
  let finalMode: boolean = false;
  let finalScores: any[] = [];
  let players: any[] = [];

  let currentPrompt: any = null;
  let errorMessage = "";
  let subscription: any;
  let result: any = null;

  let promptAuthorName = "";
  let responderA: any = null;
  let responderB: any = null;

  let playerHeadImages: string[] = [
    "gameCharacters/playerRed.png",
    "gameCharacters/playerOrange.png",
    "gameCharacters/playerYellow.png",
    "gameCharacters/playerLightGreen.png",
    "gameCharacters/playerDarkGreen.png",
    "gameCharacters/playerBlue.png",
    "gameCharacters/playerPurple.png",
    "gameCharacters/playerPink.png",
  ];

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
    finalMode = finalParam === "true";

    // Fetch and sort players
    const { data: playersData, error: playersError } = await supabase
      .from("profiles")
      .select("id")
      .eq("game_id", gameId);

    if (!playersError) {
      players = playersData.sort((a, b) => a.id.localeCompare(b.id));
    }

    subscription = supabase
      .channel("game-changes")
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "game",
          filter: `id=eq.${gameId}`,
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
      goto(`/winner?gameId=${gameId}&final=true`);
      return;
    }

    currentPrompt = prompts[promptIndex];

    if (currentPrompt?.player_id) {
      const { data: authorProfile } = await supabase
        .from("profiles")
        .select("username")
        .eq("id", currentPrompt.player_id)
        .single();
      promptAuthorName = authorProfile?.username || "Unknown";
    }

    const res = await calculatePromptScores(gameId, currentPrompt.id);
    if (res.error) {
      errorMessage = res.error;
      return;
    }
    result = res;

    if (result.tie) {
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
    clearInterval(decorationInterval);
  });

  async function fetchResponderInfo(respObj) {
    if (!respObj?.player_id) {
      return {
        username: "Unknown",
        vote_count: respObj?.vote_count || 0,
        playerIndex: -1,
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
      playerIndex: players.findIndex((p) => p.id === respObj.player_id),
    };
  }

  async function nextPrompt() {
    const newIndex = promptIndex + 1;
    if (newIndex !== promptIndex) {
      goto(`/voting?gameId=${gameId}&promptIndex=${newIndex}`);
    }
  }

  let decorationSet = 0;
  let decorationInterval;
  onMount(() => {
    decorationInterval = setInterval(() => {
      decorationSet = decorationSet === 0 ? 1 : 0;
    }, 1000);
  });
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
  <div class="page-container">
    <div class="frame">
      <!-- Header Row -->
      <div class="header-row">
        <div class="prompt-info">
          <h1>Results for Prompt #{promptIndex + 1}</h1>
          <h2>"{currentPrompt.text}"</h2>
        </div>
        <div class="author-status">
          <p class="author">
            Prompt Author: <strong>{promptAuthorName}</strong>
          </p>
          {#if result.tie}
            <p class="status">Round Status: Draw!</p>
          {:else}
            <p class="status">Round Status: Decided!</p>
          {/if}
        </div>
      </div>

      <!-- Player Results -->
      <div class="results-row">
        {#if result.tie}
          <div class="player-column">
            <div class="player-image">
              <img
                src={playerHeadImages[responderA?.playerIndex]}
                alt="Player"
              />
            </div>
            <div class="points">+{responderA?.vote_count * 100}</div>
            <div class="username">{responderA?.username}</div>
          </div>
          <div class="player-column">
            <div class="player-image">
              <img
                src={playerHeadImages[responderB?.playerIndex]}
                alt="Player"
              />
            </div>
            <div class="points">+{responderB?.vote_count * 100}</div>
            <div class="username">{responderB?.username}</div>
          </div>
        {:else}
          <div class="player-column">
            <div class="player-image winner">
              <img
                src={playerHeadImages[responderA?.playerIndex]}
                alt="Winner"
              />
            </div>
            <div class="points">+{result.bonusPoints}</div>
            <div class="username">Winner: {responderA?.username}</div>
          </div>
          <div class="player-column">
            <div class="player-image">
              <img
                src={playerHeadImages[responderB?.playerIndex]}
                alt="Runner-up"
              />
            </div>
            <div class="points">+{responderB?.vote_count * 100}</div>
            <div class="username">2nd: {responderB?.username}</div>
          </div>
        {/if}
      </div>

      <button on:click={nextPrompt}>Next Prompt</button>
    </div>
  </div>
{:else}
  <p>Loading prompt info...</p>
{/if}

<div class="decorations"></div>

<style>
  .page-container {
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 100vh;
    padding: 20px;
  }

  .frame {
    position: relative;
    width: 90vw;
    max-width: 800px;
    min-height: 500px;
    background-image: url("backgrounds/bg1.png");
    background-size: 100% 100%;
    background-repeat: no-repeat;
    background-position: center;
    padding: 40px;
    animation: bgAnimation 1.5s infinite;
  }

  .header-row {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 30px;
  }

  .prompt-info {
    flex: 2;
  }

  .author-status {
    flex: 1;
    text-align: right;
  }

  .results-row {
    display: flex;
    justify-content: space-around;
    gap: 20px;
    margin: 40px 0;
  }

  .player-column {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    width: 45%;
  }

  .player-image img {
    width: 120px;
    height: auto;
    margin-bottom: 15px;
  }

  .points {
    font-size: 1.5em;
    font-weight: bold;
    margin: 10px 0;
  }

  .username {
    font-size: 1.2em;
  }

  button {
    position: absolute;
    bottom: 30px;
    left: 50%;
    transform: translateX(-50%);
    padding: 12px 24px;
    font-size: 1.1em;
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
