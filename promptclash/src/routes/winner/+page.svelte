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
  let gameSubscription: any;
  let readySubscription: any;
  let result: any = null;

  let promptAuthorName = "";
  let responderA: any = null;
  let responderB: any = null;

  // Ready functionality
  let userId = "";
  let hasPressedReady = false;
  let transitioning = false; // local flag to ensure we only navigate once

  // Player images (adjust paths as needed)
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
  let playerWriteImages: string[] = [
    "gameCharacters/PlayerRedWrite.png",
    "gameCharacters/PlayerOrangeWrite.png",
    "gameCharacters/PlayerYellowWrite.png",
    "gameCharacters/PlayerLightGreenWrite.png",
    "gameCharacters/PlayerDarkGreenWrite.png",
    "gameCharacters/PlayerBlueWrite.png",
    "gameCharacters/PlayerPurpleWrite.png",
    "gameCharacters/PlayerPinkWrite.png",
  ];
  let playerIdleImages: string[] = [
    "gameCharacters/PlayerRedIdle.png",
    "gameCharacters/PlayerOrangeIdle.png",
    "gameCharacters/PlayerYellowIdle.png",
    "gameCharacters/PlayerLightGreenIdle.png",
    "gameCharacters/PlayerDarkGreenIdle.png",
    "gameCharacters/PlayerBlueIdle.png",
    "gameCharacters/PlayerPurpleIdle.png",
    "gameCharacters/PlayerPinkIdle.png",
  ];
  let playerHandImages: string[] = [
    "gameCharacters/playerRedHand.png",
    "gameCharacters/playerOrangeHand.png",
    "gameCharacters/playerYellowHand.png",
    "gameCharacters/playerLightGreenHand.png",
    "gameCharacters/playerDarkGreenHand.png",
    "gameCharacters/playerBlueHand.png",
    "gameharacters/playerPurpleHand.png",
    "gamecharacters/playerPinkHand.png",
  ]

  // Fetch players so we know how many there are.
  async function fetchPlayers() {
    const { data: playersData, error: playersError } = await supabase
      .from("profiles")
      .select("id, username")
      .eq("game_id", gameId);
    if (!playersError && playersData) {
      players = playersData.sort((a, b) => a.id.localeCompare(b.id));
    }
  }

  // Fetch prompt and calculate results (for non-final mode)
  async function fetchPromptAndResults() {
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
      // When no more prompts exist, switch to final mode.
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
  }

  // Helper: Fetch responder info based on calculated results.
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

  // Check if all players are ready.
  async function checkAllReady(): Promise<boolean> {
    const { data, error } = await supabase
      .from("profiles")
      .select("ready")
      .eq("game_id", gameId)
      .eq("ready", true);
    if (error || !data) {
      console.error("Error checking ready status:", error);
      return false;
    }
    return data.length === players.length;
  }

  // Called when a player clicks the ready/next button.
  async function handleReady() {
    if (hasPressedReady) {
      alert("You have already pressed ready!");
      return;
    }
    playerReadiness = {
      ...playerReadiness,
      [userId]: true
    };
    
    const { error } = await supabase
      .from("profiles")
      .update({ ready: true })
      .eq("id", userId)
      .eq("game_id", gameId);
      
    if (error) {
      errorMessage = "Failed to update ready status.";
      console.error("Error updating ready status:", error);
      // Rollback local state if error
      delete playerReadiness[userId];
      return;
    }
    hasPressedReady = true;
  }

  // Set up a realtime subscription on the profiles table to listen for ready changes.
  function setupReadySubscription() {
    readySubscription = supabase
      .channel("game-ready")
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "profiles",
          filter: `game_id=eq.${gameId}`,
        },
        async (payload) => {
          // Update local readiness state
          playerReadiness = {
            ...playerReadiness,
            [payload.new.id]: payload.new.ready
          };

          const allReady = await checkAllReady();
          if (allReady && !transitioning) {
            transitioning = true;
            if (finalMode) {
              goto(`/final?gameId=${gameId}`);
            } else {
              goto(`/voting?gameId=${gameId}&promptIndex=${promptIndex + 1}`);
            }
          }
        }
      )
      .subscribe();
  }
  
  let decorationSet = 0;
  let decorationInterval: any;
  let playerReadiness: Record<string, boolean> = {};

  onMount(async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const gameIdParam = urlParams.get("gameId");
    const promptIndexParam = urlParams.get("promptIndex");
    const finalParam = urlParams.get("final");

    if (!gameIdParam) {
      alert("No game ID found.");
      goto("/waitingroom");
      return;
    }
    gameId = Number(gameIdParam);
    promptIndex = promptIndexParam ? Number(promptIndexParam) : 0;
    finalMode = finalParam === "true";

    // Reset ready flags for this round.
    await supabase
      .from("profiles")
      .update({ ready: false })
      .eq("game_id", gameId);

    // Get the current user ID.
    const { data: sessionData } = await supabase.auth.getSession();
    userId = sessionData?.session?.user?.id || "";

    await fetchPlayers();

    if (finalMode) {
      decorationInterval = setInterval(() => {
        decorationSet = decorationSet === 0 ? 1 : 0;
      }, 1000);
      // For final mode, fetch the final scores.
      finalScores = await fetchAllPlayersScores(gameId);
    } else {
      await fetchPromptAndResults();
    }

    // Set up the realtime subscription to check for ready status.
    setupReadySubscription();

    playerReadiness = Object.fromEntries(players.map(p => [p.id, false]));
  });

  onDestroy(() => {
    if (readySubscription) {
      supabase.removeChannel(readySubscription);
    }
    if (gameSubscription) {
      supabase.removeChannel(gameSubscription);
    }
    if (decorationInterval) clearInterval(decorationInterval);  
  });

  $: playerColorIndexes = new Map(players.map((p, i) => [p.id, i % 8]));
</script>

{#if finalMode}
  <h1>Final Scoreboard</h1>
  {#if errorMessage}
    <p style="color:red;">{errorMessage}</p>
  {/if}

  <!-- Updated Final Scoreboard -->
  <div class="scoreboard">
    {#each finalScores as player, i}
      <!-- Assign each player box a color class based on i % 8 -->
      <div class="player-box color-{playerColorIndexes.get(player.id)}">
        <div class="player-rank">{i + 1}</div>
        <img
          src={playerHeadImages[players.findIndex((p) => p.id === player.id)]}
          alt={player.username}
          class="player-avatar"
        />
        <div class="player-info">
          <span class="username">{player.username}</span>
          <span class="score">{player.score} points</span>
        </div>
      </div>
    {/each}
  </div>
  <!-- Final mode ready button -->
  <div style="text-align: center; width: 100%;">
    <a href="/" class="vote-button" style="margin-top: 2rem;">
      Home
    </a>
  </div>

{:else if currentPrompt}
  <div class="page-container">
    <div class="frame">
      <h1>Results for Prompt #{promptIndex + 1}</h1>
      <h2>"{currentPrompt.text}"</h2>
      <p>Prompt Author: <strong>{promptAuthorName}</strong></p>
      {#if errorMessage}
        <p style="color:red;">{errorMessage}</p>
      {/if}
      {#if result}
        {#if result.tie}
          <h2>This round's a draw!</h2>
          <div class="tieContainer">
            <div class="tieColumn">
              <div class="tiePoints">+{responderA?.vote_count * 100}</div>
              <div class="tieImage">
                <img
                  src={playerHeadImages[responderA?.playerIndex]}
                  alt="Player"
                />
              </div>
              <div class="tieName">{responderA?.username}</div>
            </div>
            <div class="tieColumn">
              <div class="tiePoints">+{responderB?.vote_count * 100}</div>
              <div class="tieImage">
                <img
                  src={playerHeadImages[responderB?.playerIndex]}
                  alt="Player"
                />
              </div>
              <div class="tieName">{responderB?.username}</div>
            </div>
          </div>
          <p>No bonus points awarded in a tie.</p>
        {:else}
          <div class="winnerColumn">
            <div class="winnerPoints"><br /><br />+{result.bonusPoints}</div>
            <div class="winnerImage">
              <img
                src={playerHeadImages[responderA?.playerIndex]}
                alt="Winner"
              />
            </div>
            <div class="winnerName">Winner:<br />{responderA?.username}</div>
          </div>
          <div class="loserColumn">
            <div class="loserPoints">
              <br /><br />+{responderB?.vote_count * 100}
            </div>
            <div class="loserImage">
              <img
                src={playerHeadImages[responderB?.playerIndex]}
                alt="Loser"
              />
            </div>
            <div class="loserName">2nd:<br />{responderB?.username}</div>
          </div>
        {/if}
        <!-- Ready button for non-final mode -->
        <button on:click={handleReady} disabled={hasPressedReady}>
          {#if hasPressedReady}
            Waiting for others...
          {:else}
            Next Prompt
          {/if}
        </button>
      {:else}
        <p>Loading results...</p>
      {/if}
    </div>
  </div>
{:else}
  <p>Loading prompt info...</p>
{/if}

{#if finalMode}
  <!-- Final Scoreboard Content -->
  <div class="decorations">
    {#each players as _, i}
      <img
        src={decorationSet === 0 ? playerIdleImages[i] : playerWriteImages[i]}
        alt="Player decoration"
      />
    {/each}
  </div>
{:else}
  <!-- Round Winner Content -->
  <div class="decorations">
    {#each players as player, i}
      <img
        src={playerReadiness[player.id] ? playerHandImages[i] : playerIdleImages[i]}
        alt="Player status"
        class="player-status"
      />
    {/each}
  </div>
{/if}

<style>
  /* Center all H1 and H2 headings */
  h1,
  h2 {
    text-align: center;
  }

  /* -----------------------
     FINAL SCOREBOARD STYLES
     ----------------------- */
  .scoreboard {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    width: 80%;
    max-width: 600px;
    margin: 2rem auto;
  }

  /* Each player box */
  .player-box {
    display: flex;
    align-items: center;
    border-radius: 8px;
    padding: 1rem;
    color: #fff; /* default text color is white */
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  }

  /* Circular rank indicator on the left */
  .player-rank {
    width: 40px;
    height: 40px;
    background-color: rgba(255, 255, 255, 0.2); /* Slight transparency */
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-right: 1rem;
    font-size: 1.2rem;
    font-weight: bold;
  }

  /* Player avatar next to the rank */
  .player-avatar {
    width: 60px;
    height: 60px;
    border-radius: 50%;
    object-fit: cover;
    margin-right: 1rem;
  }

  /* The name & score stack vertically */
  .player-info {
    display: flex;
    flex-direction: column;
  }

  .username {
    font-weight: bold;
    font-size: 1.2rem;
  }

  .score {
    font-size: 0.9rem;
    opacity: 0.9;
  }

  /* Color classes for each player box */
  .color-0 {
    background-color: #ff4b4b; /* Red */
  }
  .color-1 {
    background-color: #ffa500; /* Orange */
  }
  .color-2 {
    background-color: #ffeb3b; /* Yellow */
    color: #000; /* Use black text for contrast */
  }
  .color-3 {
    background-color: #4caf50; /* Green */
  }
  .color-4 {
    background-color: #009688; /* Teal */
  }
  .color-5 {
    background-color: #2196f3; /* Blue */
  }
  .color-6 {
    background-color: #9c27b0; /* Purple */
  }
  .color-7 {
    background-color: #e91e63; /* Pink */
  }

  /* -----------------------------
     OTHER EXISTING STYLES BELOW
     ----------------------------- */

  button {
    position: relative;
    z-index: 2;
  }

  .page-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100vh;
  }

  .frame {
    --frame-scale: 1.2;
    display: flex;
    flex-direction: column;
    width: 95vw;
    max-width: 1200px;
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

  .winnerColumn,
  .loserColumn,
  .tieColumn {
    display: flex;
    flex-direction: column;
    text-align: center;
    align-items: center;
    margin: 1rem;
  }

  .winnerImage img,
  .loserImage img,
  .tieImage img {
    width: 100%;
    max-width: 100px;
    height: auto;
    display: block;
    margin: auto;
  }

  .decorations {
    position: fixed;
    bottom: 0;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    gap: 20px;
    z-index: -1;
  }

  .player-status {
    width: 120px;
    height: auto;
    transition: transform 0.3s ease;
  }
  .player-status:hover {
    transform: translateY(-10px);
  }

  .decorations img {
    max-width: 150px;
    height: auto;
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

  .vote-button {
    background-color: #0056b3;
    color: white;
    border: none;
    padding: 0.75rem 1.5rem;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.2s ease;
    font-size: 1.1rem;
    display: inline-block;
    text-decoration: none;
    text-align: center;
    line-height: normal;
  }

  /* Hover state for the anchor button */
  a.vote-button:hover {
    background-color: #0056b3;
    transform: translateY(-1px);
    text-decoration: none;
  }
</style>
