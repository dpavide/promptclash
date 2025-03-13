<script lang="ts">
  import { supabase } from "$lib/supabaseClient";
  import { goto } from "$app/navigation";
  import { onMount } from "svelte";

  let currentGame;
  let players: { id: string; username: string }[] = [];
  let gameId;
  export let playerimages: string[] = [
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
    const gameIdParam = urlParams.get("gameId");
    if (!gameIdParam) {
      alert("No game specified.");
      return;
    }
    gameId = Number(gameIdParam);

    const { data: gameData, error: gameError } = await supabase
      .from("game")
      .select("*")
      .eq("id", gameId)
      .single();
    if (gameError || !gameData) {
      alert("Game not found.");
      return;
    }
    currentGame = gameData;

    const channel = supabase
      .channel("game")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "profiles",
          filter: `game_id=eq.${currentGame.id}`,
        },
        async () => {
          const { data } = await supabase
            .from("profiles")
            .select("id, username")
            .eq("game_id", currentGame.id);
          players = data ? data.sort((a, b) => a.id.localeCompare(b.id)) : [];
        }
      )
      .subscribe();

    const { data: initialPlayers } = await supabase
      .from("profiles")
      .select("id, username")
      .eq("game_id", currentGame.id);
    players = initialPlayers
      ? initialPlayers.sort((a, b) => a.id.localeCompare(b.id))
      : [];

    const gameChannel = supabase
      .channel("game-start")
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "game",
          filter: `id=eq.${currentGame.id}`,
        },
        (payload) => {
          if (payload.new.prompt_id) {
            goto(`/game?gameId=${currentGame.id}`);
          }
        }
      )
      .subscribe();

    return () => {
      if (channel) supabase.removeChannel(channel);
      if (gameChannel) supabase.removeChannel(gameChannel);
    };
  });

  async function startGame() {
    if (players.length < 3) {
      alert("At least 3 players are required to start the game!");
      return;
    }
    try {
      const { count: promptCount, error: countError } = await supabase
        .from("prompts")
        .select("id", { count: "exact", head: true });
      if (countError) throw countError;
      if (!promptCount || promptCount === 0) {
        throw new Error("No prompts available");
      }

      const randomOffset = Math.floor(Math.random() * promptCount);
      const { data: promptData, error: promptError } = await supabase
        .from("prompts")
        .select("id")
        .range(randomOffset, randomOffset)
        .single();
      if (promptError || !promptData) {
        throw new Error("No prompts available");
      }

      const { error: updateError } = await supabase
        .from("game")
        .update({ prompt_id: promptData.id })
        .eq("id", currentGame.id);
      if (updateError) throw updateError;
    } catch (error) {
      console.error("Failed to start the game:", error);
      alert(error.message || "Failed to start the game. Please try again.");
    }
  }
</script>

<h1>WAITING FOR PLAYERS TO JOIN</h1>

{#if currentGame}
  <p class="game-id">Game ID: {currentGame.id}</p>
{/if}

<!-- If no players have joined yet, show a waiting message -->
{#if players.length === 0}
  <p class="waiting-text">Waiting for players to join...</p>
{:else}
  <!-- Display each player in its own box -->
  <div class="players">
    {#each players as player, i}
      <div class="player-box color-{i % 8}">
        <div class="player-icon">
          <!-- Show the corresponding image for the player’s index -->
          <img src={playerimages[i % playerimages.length]} alt="Player icon" />
        </div>
        <div class="player-label">
          {player.username}
        </div>
      </div>
    {/each}
  </div>
{/if}

<!-- Start/Play button below all players -->
<button class="start-button" on:click={startGame} disabled={players.length < 3}>
  Start Game ({players.length}/3+)
</button>

<style>
  /* Basic page styling */
  :global(body) {
    margin: 0;
    padding: 0;
    background-color: #4cb3ff; /* Bright blue background */
    font-family: Arial, sans-serif;
    text-align: center;
    color: #000;
  }

  h1 {
    margin: 2rem 0 1rem 0;
    font-size: 2rem;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: #fff;
  }

  .game-id {
    color: #fff;
    margin-bottom: 1rem;
  }

  .waiting-text {
    color: #fff;
    font-style: italic;
    margin: 2rem 0;
  }

  /* Container for all player boxes */
  .players {
    display: flex;
    flex-direction: column;
    align-items: center;
    max-width: 600px;
    margin: 2rem auto;
  }

  /* Individual player box */
  .player-box {
    display: flex;
    align-items: center;
    width: 100%;
    max-width: 400px;
    margin: 1rem 0;
    padding: 1rem;
    border-radius: 10px;
    color: #fff;
  }

  /* Player icon container */
  .player-icon {
    width: 45px;
    height: 45px;
    border-radius: 50%;
    background-color: rgba(255, 255, 255, 0.2);
    display: flex;
    align-items: center;
    justify-content: center;
    margin-right: 1rem;
    overflow: hidden; /* so the image is clipped to a circle */
  }

  /* Make sure the image fits nicely in the icon circle */
  .player-icon img {
    width: 100%;
    height: 100%;
    object-fit: contain; /* or "cover" if you prefer filling the circle */
  }

  .player-label {
    font-weight: bold;
    font-size: 1.1rem;
  }

  /* Example color classes for the boxes */
  .color-0 {
    background-color: #ff4b4b;
  } /* Red */
  .color-1 {
    background-color: #ffa500;
  } /* Orange */
  .color-2 {
    background-color: #ffeb3b;
    color: #000;
  } /* Yellow (with black text) */
  .color-3 {
    background-color: #4caf50;
  } /* Green */
  .color-4 {
    background-color: #009688;
  } /* Teal/dark green */
  .color-5 {
    background-color: #2196f3;
  } /* Blue */
  .color-6 {
    background-color: #9c27b0;
  } /* Purple */
  .color-7 {
    background-color: #e91e63;
  } /* Pink */

  /* The PLAY! button below the players */
  .start-button {
    padding: 1rem 2rem;
    font-size: 1.2rem;
    background-color: #fff;
    color: #000;
    border: 2px solid #000;
    border-radius: 10px;
    cursor: pointer;
    margin-bottom: 2rem;
  }
  .start-button:hover {
    background-color: #ccc;
  }
  .start-button:disabled {
    background-color: #999;
    border-color: #999;
    cursor: not-allowed;
  }
</style>
