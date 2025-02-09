<script>
  import { supabase } from "$lib/supabaseClient";
  import { goto } from "$app/navigation";
  import { onMount } from "svelte";

  let currentGame; // The current game object
  let players = []; // List of players in the waiting room

  // Fetch or create the latest game
  async function fetchOrCreateGame() {
    // Try to fetch the latest game
    const { data: existingGame, error } = await supabase
      .from("game")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (!error && existingGame) return existingGame;

    // If no game exists, create a new one
    const { data: newGame, error: createError } = await supabase
      .from("game")
      .insert([{}])
      .select("*")
      .single();

    if (createError) throw createError;
    return newGame;
  }

  // Start the game by assigning a random prompt
  async function startGame() {
    if (!currentGame?.id || players.length < 2) {
      alert("At least 2 players are required to start the game!");
      return;
    }

    try {
      // First, count the number of prompts available
      const { count: promptCount, error: countError } = await supabase
        .from("prompts")
        .select("id", { count: "exact", head: true });
      if (countError) throw countError;
      if (!promptCount || promptCount === 0) {
        throw new Error("No prompts available");
      }

      // Generate a random offset into the prompts table
      const randomOffset = Math.floor(Math.random() * promptCount);

      // Fetch the prompt at that offset
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

  // Initialize the waiting room
  onMount(async () => {
    try {
      // Fetch or create the latest game
      currentGame = await fetchOrCreateGame();

      // Set up real-time updates for the player list
      const channel = supabase
        .channel("game")
        .on(
          "postgres_changes",
          {
            event: "*", // Listen for all changes
            schema: "public",
            table: "profiles",
            filter: `game_id=eq.${currentGame.id}`,
          },
          async () => {
            // Fetch the updated list of players
            const { data } = await supabase
              .from("profiles")
              .select("username")
              .eq("game_id", currentGame.id);
            players = data || [];
          }
        )
        .subscribe();

      // Initial fetch of players
      const { data } = await supabase
        .from("profiles")
        .select("username")
        .eq("game_id", currentGame.id);
      players = data || [];

      // Set up a channel to monitor for game updates (i.e. when a prompt is assigned)
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
            // Redirect to the game page when a prompt is assigned
            if (payload.new.prompt_id) {
              goto("/game");
            }
          }
        )
        .subscribe();

      // Return a cleanup function to unsubscribe when the component unmounts
      return () => {
        channel.unsubscribe();
        gameChannel.unsubscribe();
      };
    } catch (error) {
      console.error("Error initializing waiting room:", error);
      alert("Failed to initialize the waiting room. Please refresh the page.");
    }
  });
</script>

<h1>Waiting Room</h1>

{#if players.length > 0}
  <div class="player-list">
    {#each players as player}
      <div class="player">• {player.username}</div>
    {/each}
  </div>
{:else}
  <p>Waiting for players to join...</p>
{/if}

<button on:click={startGame} disabled={players.length < 2}>
  Start Game ({players.length}/2+)
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
