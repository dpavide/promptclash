<script lang="ts">
  import { supabase } from "$lib/supabaseClient";
  import { goto } from "$app/navigation";
  import { onMount, onDestroy } from "svelte";

  let currentGame;
  let players: Array<{ id: string; username: string; is_host?: boolean }> = [];
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
  let currentUser = { id: "", username: "", is_host: false };
  let channel: any = null;
  let delete_channel: any = null;
  let gameChannel: any = null;

  async function fetchCurrentUserProfile() {
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData?.session?.user?.id) return;
    const userId = sessionData.session.user.id;
    const { data, error } = await supabase
      .from("profiles")
      .select("id, username, is_host")
      .eq("id", userId)
      .single();
    if (error) {
      console.error("Error fetching current user profile:", error);
      return;
    }
    currentUser = data;
  }

  async function kickPlayer(playerId: string) {
    if (!confirm("Are you sure you want to kick this player?")) return;

    const { error } = await supabase
      .from("profiles")
      .update({ in_game: false })
      .eq("id", playerId)
      .eq("game_id", gameId);

    if (error) {
      console.error("Error kicking player:", error);
      alert("Failed to kick the player. Please try again.");
    }
  }

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

    await fetchCurrentUserProfile();

    channel = supabase
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
          await refreshPlayers(); // Re-fetch player list
        }
      )
      .subscribe();

    await refreshPlayers();

    gameChannel = supabase
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
  });

  onDestroy(() => {
    if (channel) supabase.removeChannel(channel);
    if (gameChannel) supabase.removeChannel(gameChannel);
  });

  async function refreshPlayers() {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, username, is_host, in_game")
      .eq("game_id", gameId);

    if (error) {
      console.error("Error refreshing players:", error);
      return;
    }

    // Filter out players who are not in the game
    players = data ? data.filter((player) => player.in_game) : [];
    console.log("players in game", players);

    // Sort players by ID for consistent display
    players = players.sort((a, b) => a.id.localeCompare(b.id));

    // If the current user is not in that array, it means they've been kicked
    // => redirect them to the landing page
    if (!players.some((p) => p.id === currentUser.id)) {
      goto("/");
    }
  }

  async function startGame() {
    if (!currentUser.is_host) {
      alert("Only the host can start the game.");
      return;
    }
    if (players.length < 3) {
      alert("At least 3 players are required to start the game!");
      return;
    }
    if (players.length >= 9) {
      alert("You can't have more than 8 players in a game!");
      return;
    }
    // Delete players with in_game = false
    try {
      const { error: deleteError } = await supabase
        .from("profiles")
        .delete()
        .eq("game_id", gameId)
        .eq("in_game", false);

      if (deleteError) {
        throw new Error("Failed to delete players not in game.");
      }
      console.log("Deleted players with in_game = false.");
    } catch (error) {
      console.error("Failed to delete players:", error);
      alert("An error occurred while deleting players.");
      return; // Exit function if deletion fails
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
  <span class="game-id">Game ID: {currentGame.id}</span>
{/if}

<!-- If no players have joined yet, show a waiting message -->
{#if players.length === 0}
  <p class="waiting-text">Waiting for players to join...</p>
{:else}
  <!-- Display each player in its own box -->
  <div class="players">
    {#each players as player, i}
      <div class="player-box color-{i % 8}">
        <div class="left">
          <div class="player-icon">
            <!-- Show the corresponding image for the player’s index -->
            <img
              src={playerimages[i % playerimages.length]}
              alt="Player icon"
            />
          </div>
          <div class="player-label">
            {player.username}
            {player.is_host ? "👑 (Host)" : ""}
          </div>
        </div>

        {#if currentUser.is_host && !player.is_host}
          <button
            on:click={() => kickPlayer(player.id)}
            style="margin-left: 10px; background-color: red; color: white; border: none; border-radius: 3px; padding: 2px 5px;"
          >
            Kick
          </button>
        {/if}
      </div>
    {/each}
  </div>
{/if}

<!-- Start/Play button below all players -->
{#if currentUser.is_host}
  <button
    class="start-button"
    on:click={startGame}
    disabled={players.length < 3 || players.length >= 9}
  >
    {players.length >= 8
      ? "Start Game, Room Full!"
      : players.length >= 3
        ? `Start Game (${players.length}/8)`
        : `Start Game (${players.length}/3+)`}
  </button>
{:else}
  <p>Waiting for the host to start the game...</p>
{/if}

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
    font-size: 1.6rem;
    padding: 10px;
    background: rgb(0, 96, 251);
    border-radius: 10px;
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
    gap: 1rem;
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
    justify-content: space-between;
  }

  .left {
    display: flex;
    align-items: center;
    gap: 0.75rem;
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

  .kick-button {
    background-color: red;
    color: white;
    border: none;
    border-radius: 3px;
    padding: 5px 8px;
    cursor: pointer;
  }
  .kick-button:hover {
    background-color: #cc0000;
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