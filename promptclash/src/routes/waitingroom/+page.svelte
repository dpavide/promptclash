<script lang="ts">
  import { supabase } from "$lib/supabaseClient";
  import { goto } from "$app/navigation";
  import { onMount } from "svelte";

  let currentGame;
  let players: { username: string }[] = [];
  let gameId;

  onMount(async () => {
    // Get gameId from the URL query parameters
    const urlParams = new URLSearchParams(window.location.search);
    const gameIdParam = urlParams.get("gameId");
    if (!gameIdParam) {
      alert("No game specified.");
      return;
    }
    gameId = Number(gameIdParam);

    // Fetch the game record by its ID
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

    // Set up a subscription to update the player list
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
            .select("username")
            .eq("game_id", currentGame.id);
          players = data || [];
        }
      )
      .subscribe();

    // Initial fetch of players
    const { data: initialPlayers } = await supabase
      .from("profiles")
      .select("username")
      .eq("game_id", currentGame.id);
    players = initialPlayers || [];

    // Listen for game updates (e.g. when a prompt is assigned)
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
            // Pass gameId in the URL when redirecting
            goto(`/game?gameId=${currentGame.id}`);
          }
        }
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
      gameChannel.unsubscribe();
    };
  });

  async function startGame() {
    if (players.length < 3) {
      alert("At least 3 players are required to start the game!");
      return;
    }
    try {
      // Count available prompts
      const { count: promptCount, error: countError } = await supabase
        .from("prompts")
        .select("id", { count: "exact", head: true });
      if (countError) throw countError;
      if (!promptCount || promptCount === 0) {
        throw new Error("No prompts available");
      }

      // Pick a random prompt
      const randomOffset = Math.floor(Math.random() * promptCount);
      const { data: promptData, error: promptError } = await supabase
        .from("prompts")
        .select("id")
        .range(randomOffset, randomOffset)
        .single();
      if (promptError || !promptData) {
        throw new Error("No prompts available");
      }

      // Update the game with the selected prompt
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

<h1>Waiting Room</h1>

<!-- Show the game ID -->
{#if currentGame}
  <p>Game ID: {currentGame.id}</p>
{/if}

{#if players.length > 0}
  <div class="player-list">
    {#each players as player}
      <div class="player">• {player.username}</div>
    {/each}
  </div>
{:else}
  <p>Waiting for players to join...</p>
{/if}

<button on:click={startGame} disabled={players.length < 3}>
  Start Game ({players.length}/3+)
</button>

<style>
  .player-list {
    margin: 1rem 0;
    padding: 1rem;
    border: 1px solid #ccc;
    border-radius: 4px;
  }
  .player {
    margin: 0.5rem 0;
  }
  button {
    padding: 0.5rem 1rem;
    font-size: 1rem;
    background-color: #007bff;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
  }
  button:hover {
    background-color: #0056b3;
  }
  button:disabled {
    background-color: #ccc;
    cursor: not-allowed;
  }
</style>
