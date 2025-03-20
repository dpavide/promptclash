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
  <div class="scoreboard">
    {#each finalScores as player, i}
      <div class="player-entry">
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
  <div class="topText">
    {#if result}
      {#if result.tie}

        <h1>Prompt #{promptIndex + 1}: This round is a DRAW!</h1>
        <h2>Prompt Author: <strong>{promptAuthorName}</strong></h2>
      {:else}
        <h1>Prompt #{promptIndex + 1}: {responderA?.username} WINS this round!!!</h1>
        <h2>Prompt Author: <strong>{promptAuthorName}</strong></h2>
      {/if}
      
    {/if} 
  </div>  
  <div class="page-container">  
      {#if errorMessage}
        <p style="color: red;">{errorMessage}</p>
      {/if}

      {#if result}
        {#if result.tie}
        <div class="frame">
          <div class="tieLeftColumn">
            <div class="tiePoints">+{responderA?.vote_count * 100}</div>
            <div class="tieImage">
              <img src={playerHeadImages[responderA?.playerIndex]} alt="Player Image" />
            </div>
            <div class="tieName">{responderA?.username}</div>
          </div>
      
          <div class="PromptMiddleColumn">
            <h2>"{currentPrompt.text}"</h2>
            <p>No bonus points awarded in a tie.</p>
            <button on:click={handleReady} disabled={hasPressedReady}>
              {#if hasPressedReady}
                Waiting for others...
              {:else}
                Next Prompt
              {/if}
            </button>    
          </div>
      
          <div class="tieRightColumn">
            <div class="tiePoints">+{responderB?.vote_count * 100}</div>
            <div class="tieImage">
              <img src={playerHeadImages[responderB?.playerIndex]} alt="Player Image" />
            </div>
            <div class="tieName">{responderB?.username}</div>
          </div>
        </div>

        {:else}
          <div class="frame">
            <div class="winnerColumn">
              <div class="winnerPoints">+{result.bonusPoints}</div>
              <div class="winnerImage">
                <img src={playerHeadImages[responderA?.playerIndex]} alt="Winner Image" />
              </div>
              <div class="winnerName">Winner:<br />{responderA?.username}</div>
            </div>
        
            <div class="PromptMiddleColumn">
              <h2>"{currentPrompt.text}"</h2>
              <button on:click={handleReady} disabled={hasPressedReady}>
                {#if hasPressedReady}
                  Waiting for others...
                {:else}
                  Next Prompt
                {/if}
              </button>
      
            </div>
        
            <div class="loserColumn">
              <div class="loserPoints">+{responderB?.vote_count * 100}</div>
              <div class="loserImage">
                <img src={playerHeadImages[responderB?.playerIndex]} alt="Loser Image" />
              </div>
              <div class="loserName">2nd:<br />{responderB?.username}</div>
            </div>
          </div>
        {/if}
      {:else}
        <p>Loading results...</p>
      {/if}
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
  h1,
  h2 {
    text-align: center;
  }
  .scoreboard {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    width: 80%;
    max-width: 600px;
    margin: 2rem auto;
  }
  .player-entry {
    display: flex;
    align-items: center;
    gap: 1.5rem;
    padding: 1rem;
    background: rgba(255, 255, 255, 0.9);
    border-radius: 10px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  }
  .player-avatar {
    width: 60px;
    height: 60px;
    object-fit: contain;
  }
  .player-info {
    display: flex;
    flex-direction: column;
    flex-grow: 1;
  }
  .username {
    font-weight: bold;
    font-size: 1.2rem;
  }
  .score {
    color: #666;
    font-size: 0.9rem;
  }
  .player-rank {
    font-size: 1.5rem;
    font-weight: bold;
    min-width: 40px;
    text-align: center;
    color: #4a90e2;
  }
  button {
    position: relative;
    z-index: 2;
  }

  .topText{
    font-size: clamp(8px, 8vw, 20px);
    text-decoration: underline;
    transform: translateY(100%);  

  }
  
  h1,
  h2 {
    text-align: center;
  }
 
  button {
    padding: 10px 20px;
    margin-top: 20px;
    cursor: pointer;
  }

  .page-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    
    height: 100vh;
  }
  .frame {
    transform: translateY(-10%);
    --frame-scale: 1.2;
    --base-offset: 50px;
    display: flex;
    flex-direction: row;
    width: 95vw;
    max-width: 1000px;
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
    
    padding: 1rem;
    margin: 1px; 
  }
  .frame > * {
    transform: translateY(calc(-1 * var(--base-offset) * var(--frame-scale)));
  }

  
  .PromptMiddleColumn{
    font-style: italic;
    font-size: clamp(8px, 3vw, 20px);
    display: flex;
    max-width: 300px;
    flex-direction: column; 
    align-items: center; 
    justify-content: center; 
    height: 100vh; 
    text-align: center; 
}


  
  .winnerColumn,
  .tieLeftColumn{
    font-size: clamp(20px, 8vw, 30px);
    display: flex;
    flex-direction: column;
    text-align: center;
    align-items: center;
    margin: 1rem;
    margin-left: 100px;
  }
  .loserColumn,
  .tieRightColumn{
    font-size: clamp(20px, 8vw, 30px);
    display: flex;
    flex-direction: column;
    text-align: center;
    align-items: center;
    margin: 1rem;
    margin-right: 100px;
  }
  
  .winnerImage img,
  .loserImage img,
  .tieImage img {
    width: 100%;
    max-width: 130px;
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
    gap: 20 px;
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
    /* Existing button styles */
    background-color: #0056b3;
    color: white;
    border: none;
    padding: 0.75rem 1.5rem;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.2s ease;
    font-size: 1.1rem;
    
    /* Add these for anchor elements */
    display: inline-block;
    text-decoration: none;
    text-align: center;
    line-height: normal;
  }

  /* Add specific anchor button hover state */
  a.vote-button:hover {
    background-color: #0056b3;
    transform: translateY(-1px);
    text-decoration: none;
  }
</style>

