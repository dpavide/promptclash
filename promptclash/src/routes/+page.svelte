<script>
  import { supabase } from "$lib/supabaseClient";
  import { goto } from "$app/navigation";
  // Notice: we no longer import initializeDatabase here

  let username = "";
  let roomCode = "";

  // Create Room: Sign in, create a new game, add the user, and redirect.
  async function handleCreateRoom() {
    if (!username.trim()) {
      alert("Please enter a username");
      return;
    }
    try {
      // Sign in anonymously
      const { data: authData, error: authError } =
        await supabase.auth.signInAnonymously();
      if (authError) {
        console.error("Error during anonymous sign-in:", authError);
        alert("Failed to sign in. Please try again.");
        return;
      }

      // Dynamically import the API so that initializeDatabase is only loaded and called when the button is pressed
      const { initializeDatabase } = await import("$lib/api");
      const newGameData = await initializeDatabase();
      if (!newGameData || !newGameData[0]) {
        alert("Failed to create game. Please try again.");
        return;
      }
      const gameId = newGameData[0].id;
      console.log("New game created with id:", gameId);

      // Add the user to the new game
      const { error: profileError } = await supabase.from("profiles").insert([
        {
          id: authData.user.id,
          username: username.trim(),
          game_id: gameId,
          is_host: true
        },
      ]);
      if (profileError) {
        console.error("Error adding user to game:", profileError);
        alert("Failed to join the game. Please try again.");
        return;
      }
      // Redirect to the waiting room with the gameId in the query string
      goto(`/waitingroom?gameId=${gameId}`);
    } catch (error) {
      console.error("Error in handleCreateRoom:", error);
      alert("An unexpected error occurred. Please try again.");
    }
  }

  // Join Game: Validate room code, sign in, add the user to that game, and redirect.
  async function handleJoinGame() {
    if (!username.trim()) {
      alert("Please enter a username");
      return;
    }
    if (!roomCode.trim()) {
      alert("Please enter a room code");
      return;
    }
    try {
      // Look up the game by its ID (the room code)
      const { data: game, error } = await supabase
        .from("game")
        .select("id")
        .eq("id", Number(roomCode.trim()))
        .maybeSingle();
      if (error) {
        console.error("Error fetching game:", error);
        alert("Error checking room code. Please try again.");
        return;
      }
      if (!game) {
        alert("Game does not exist!");
        return;
      }

      // Sign in anonymously
      const { data: authData, error: authError } =
        await supabase.auth.signInAnonymously();
      if (authError) {
        console.error("Error during anonymous sign-in:", authError);
        alert("Failed to sign in. Please try again.");
        return;
      }

      // Add the user to the found game
      const { error: profileError } = await supabase.from("profiles").insert([
        {
          id: authData.user.id,
          username: username.trim(),
          game_id: game.id,
          is_host: false
        },
      ]);
      if (profileError) {
        console.error("Error adding user to game:", profileError);
        alert("Failed to join the game. Please try again.");
        return;
      }
      goto(`/waitingroom?gameId=${game.id}`);
    } catch (error) {
      console.error("Error in handleJoinGame:", error);
      alert("An unexpected error occurred. Please try again.");
    }
  }
</script>

<div class="container">
  <div class="header">
    <h1>PROMPT CLASH!</h1>
  </div>

  <div class="main-content">
    <!-- Left Player Icons -->
    <div class="left-players">
      <img src="gameCharacters/playerRed.png" alt="Red Player" class="player" />
      <img
        src="gameCharacters/playerOrange.png"
        alt="Orange Player"
        class="player"
      />
      <img
        src="gameCharacters/playerYellow.png"
        alt="Yellow Player"
        class="player"
      />
      <img
        src="gameCharacters/playerLightGreen.png"
        alt="Light Green Player"
        class="player"
      />
    </div>

    <div class="form-container">
      <!-- Name input -->
      <input
        type="text"
        bind:value={username}
        placeholder="Name"
        class="name-input"
        maxlength=25
        required
      />

      <!-- Join Game Section -->
      <div class="join-section">
        <input
          type="text"
          bind:value={roomCode}
          placeholder="Room Code"
          class="room-input"
          required
        />
        <button class="play-button" on:click={handleJoinGame}>
          Join Game
        </button>
      </div>

      <small>OR</small>

      <!-- Create Room Button -->
      <button class="play-button" on:click={handleCreateRoom}>
        Create Room
      </button>
    </div>

    <!-- Right Player Icons -->
    <div class="right-players">
      <img
        src="gameCharacters/playerDarkGreen.png"
        alt="Dark Green Player"
        class="player"
      />
      <img
        src="gameCharacters/playerBlue.png"
        alt="Blue Player"
        class="player"
      />
      <img
        src="gameCharacters/playerPink.png"
        alt="Pink Player"
        class="player"
      />
      <img
        src="gameCharacters/playerPurple.png"
        alt="Purple Player"
        class="player"
      />
    </div>
  </div>
</div>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
  }
  .container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    background-color: #078fd8;
  }
  .header h1 {
    font-size: 3em;
    color: white;
    text-shadow: 2px 2px 5px black;
  }
  .main-content {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 80%;
    max-width: 900px;
  }
  .left-players,
  .right-players {
    display: flex;
    flex-direction: column;
    gap: 15px;
    padding: 15px;
  }
  .player {
    width: 80px;
    height: auto;
  }
  .form-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 15px;
    background-color: white;
    padding: 20px;
    border-radius: 10px;
    border: 2px solid #ccc;
  }
  .name-input,
  .room-input {
    padding: 10px;
    font-size: 1em;
    border: 2px solid #ccc;
    border-radius: 5px;
    width: 200px;
    outline: none;
  }
  .play-button {
    padding: 10px 20px;
    font-size: 1.2em;
    color: white;
    background-color: #007bff;
    border: none;
    border-radius: 5px;
    cursor: pointer;
  }
  .play-button:hover {
    background-color: #0056b3;
  }
</style>
