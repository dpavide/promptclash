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

    // if tie => we have respA & respB; otherwise, we have winner & loser
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
    // ─── NEW: Clear decoration animation interval
    clearInterval(decorationInterval);
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
    console.log(newIndex)

    if (newIndex !== promptIndex) {
            // universal redirect
            goto(`/voting?gameId=${gameId}&promptIndex=${newIndex}`);
      }
    }

  // ─── NEW: Decoration animation variables and interval setup ─────────
  let decorationSet = 0;
  let decorationInterval;
  onMount(() => {
    decorationInterval = setInterval(() => {
      decorationSet = decorationSet === 0 ? 1 : 0;
    }, 1000);
  });
</script>

{#if finalMode}
  <!-- Final Scoreboard remains as before -->
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
  <!-- New UI layout with a styled frame and two-column result display -->
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
                <img src="gameCharacters/playerRed.png" alt="Player Image">
              </div>
              <div class="tieName">{responderA?.username}</div>
            </div>
            <div class="tieColumn">
              <div class="tiePoints">+{responderB?.vote_count * 100}</div>
              <div class="tieImage">
                <img src="gameCharacters/playerBlue.png" alt="Player Image">
              </div>
              <div class="tieName">{responderB?.username}</div>
            </div>
          </div>
          <p>No bonus points awarded in a tie.</p>
        {:else}
          <div class="winnerColumn">
            <div class="winnerPoints"><br><br>+{result.bonusPoints}</div>
            <div class="winnerImage">
              <img src="gameCharacters/playerRed.png" alt="Winner Image">
            </div>
            <div class="winnerName">Winner:<br>{responderA?.username}</div>
          </div>
          <div class="loserColumn">
            <div class="loserPoints"><br><br>+{responderB?.vote_count * 100}</div>
            <div class="loserImage">
              <img src="gameCharacters/playerBlue.png" alt="Loser Image">
            </div>
            <div class="loserName">2nd:<br>{responderB?.username}</div>
          </div>
        {/if}
        <button on:click={nextPrompt}>Next Prompt</button>
      {:else}
        <p>Loading results...</p>
      {/if}
    </div>
  </div>
{:else}
  <p>Loading prompt info...</p>
{/if}

<!-- Decoration Images at the very bottom with animation -->
<div class="decorations">
  <img src={decorationSet === 0 ? "gameCharacters/PlayerOrangeIdle.png" : "gameCharacters/PlayerOrangeWrite.png"} alt="Decoration Orange">
  <img src={decorationSet === 0 ? "gameCharacters/PlayerYellowIdle.png" : "gameCharacters/PlayerYellowWrite.png"} alt="Decoration Yellow">
  <img src={decorationSet === 0 ? "gameCharacters/PlayerDarkGreenIdle.png" : "gameCharacters/PlayerDarkGreenWriting.png"} alt="Decoration Dark Green">
  <img src={decorationSet === 0 ? "gameCharacters/PlayerLightGreenIdle.png" : "gameCharacters/PlayerLightGreenWrite.png"} alt="Decoration Light Green">
  <img src={decorationSet === 0 ? "gameCharacters/PlayerPurpleIdle.png" : "gameCharacters/PlayerPurpleWrite.png"} alt="Decoration Purple">
</div>

<style>
  /* Styles from the current winner page */
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

  /* New styles from the older version for enhanced layout */
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
  .winnerColumn, .loserColumn, .tieColumn {
    display: flex;
    flex-direction: column;
    text-align: center;
    align-items: center;
    margin: 1rem;
  }
  .winnerImage img, .loserImage img, .tieImage img {
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
