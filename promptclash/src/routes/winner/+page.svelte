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
  let readySubscription: any; // subscription for ready status changes
  let result: any = null;

  let promptAuthorName = "";
  let responderA: any = null;
  let responderB: any = null;

  // Ready functionality variables:
  let userId = "";
  let hasPressedReady = false;

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

  // Checks if all players in the game have their ready flag set to true.
  async function checkAllReady(gameId: number): Promise<boolean> {
    const { data, error } = await supabase
      .from("profiles")
      .select("ready")
      .eq("game_id", gameId);
    if (error || !data) {
      console.error("Error checking ready status:", error);
      return false;
    }
    return data.every((profile) => profile.ready === true);
  }

  // When the button is clicked, update this player's ready flag in the database.
  async function handleReady() {
    if (hasPressedReady) {
      alert("You have already pressed ready!");
      return;
    }
    const { error } = await supabase
      .from("profiles")
      .update({ ready: true })
      .eq("id", userId)
      .eq("game_id", gameId);
    if (error) {
      errorMessage = "Failed to update ready status.";
      console.error("Error updating ready status:", error);
      return;
    }
    hasPressedReady = true;
    // Check immediately if everyone is ready.
    const allReady = await checkAllReady(gameId);
    if (allReady) {
      nextPrompt();
    }
  }

  // Realtime subscription to monitor players' ready status.
  function setupReadySubscription() {
    readySubscription = supabase
      .channel("game-ready")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "profiles",
          filter: `game_id=eq.${gameId}`,
        },
        async () => {
          const allReady = await checkAllReady(gameId);
          if (allReady) {
            nextPrompt();
          }
        }
      )
      .subscribe();
  }

  // This function resets the ready flags and navigates to the next prompt.
  async function nextPrompt() {
    // Reset ready flags for all players
    const { error } = await supabase
      .from("profiles")
      .update({ ready: false })
      .eq("game_id", gameId);
    if (error) {
      console.error("Error resetting ready flags:", error);
    }
    const newIndex = promptIndex + 1;
    if (newIndex !== promptIndex) {
      goto(`/voting?gameId=${gameId}&promptIndex=${newIndex}`);
    }
  }

  let decorationSet = 0;
  let decorationInterval;
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

    // Get the current user id from session.
    const { data: sessionData } = await supabase.auth.getSession();
    userId = sessionData?.session?.user?.id || "";

    // Fetch and sort players.
    const { data: playersData, error: playersError } = await supabase
      .from("profiles")
      .select("id")
      .eq("game_id", gameId);
    if (!playersError && playersData) {
      players = playersData.sort((a, b) => a.id.localeCompare(b.id));
    }

    // Subscription for game changes (e.g. if current prompt index is updated externally).
    gameSubscription = supabase
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

    // Fetch prompts.
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

    setupReadySubscription();

    decorationInterval = setInterval(() => {
      decorationSet = decorationSet === 0 ? 1 : 0;
    }, 1000);
  });

  onDestroy(() => {
    if (gameSubscription) {
      supabase.removeChannel(gameSubscription);
    }
    if (readySubscription) {
      supabase.removeChannel(readySubscription);
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
</script>

{#if finalMode}
  <h1>Final Scoreboard</h1>
  {#if errorMessage}
    <p style="color: red;">{errorMessage}</p>
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
{:else if currentPrompt}
  <div class="page-container">
    <div class="frame">
      <h1>Results for Prompt #{promptIndex + 1}</h1>
      <h2>"{currentPrompt.text}"</h2>
      <p>Prompt Author: <strong>{promptAuthorName}</strong></p>
      {#if errorMessage}
        <p style="color: red;">{errorMessage}</p>
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
        <!-- Next Prompt button: each player presses this which updates their ready flag.
             Live subscription will trigger nextPrompt() once everyone is ready. -->
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

<div class="decorations">
  {#each players as _, i}
    <img
      src={decorationSet === 0 ? playerIdleImages[i] : playerWriteImages[i]}
      alt="Player decoration"
    />
  {/each}
</div>

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
</style>
