<script>
  import { supabase } from "$lib/supabaseClient";
  import { goto } from "$app/navigation";

  let username = "";

  async function handleAnonymousSignIn() {
    if (!username.trim()) {
      alert("Please enter a username");
      return;
    }

    try {
      // Perform anonymous sign-in
      const { data: authData, error: authError } =
        await supabase.auth.signInAnonymously();
      if (authError) {
        console.error("Error during anonymous sign-in:", authError);
        alert("Failed to sign in. Please try again.");
        return;
      }

      // Get or create the latest game
      const { data: latestGame, error: gameError } = await supabase
        .from("game")
        .select("id")
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      let gameId;
      if (gameError || !latestGame) {
        // Create a new game if none exists
        const { data: newGame, error: newGameError } = await supabase
          .from("game")
          .insert([{}])
          .select("id")
          .single();

        if (newGameError) {
          console.error("Error creating new game:", newGameError);
          alert("Failed to create a new game. Please try again.");
          return;
        }

        gameId = newGame.id;
      } else {
        gameId = latestGame.id;
      }

      // Add the user to the profiles table (using the 'id' column)
      const { error: profileError } = await supabase.from("profiles").upsert({
        id: authData.user.id, // Use the user id from authentication
        username: username.trim(),
        game_id: gameId,
      });

      if (profileError) {
        console.error("Error adding user to profiles:", profileError);
        alert("Failed to join the game. Please try again.");
        return;
      }

      // Redirect to the waiting room
      goto("/waitingroom");
    } catch (error) {
      console.error("Error in handleAnonymousSignIn:", error);
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

    <!-- Input and Button -->
    <div class="form-container">
      <form on:submit|preventDefault={handleAnonymousSignIn}>
        <input
          type="text"
          bind:value={username}
          placeholder="Name"
          class="name-input"
          required
        />
        <input
          type="text"
          placeholder="Room Code"
          class="room-input"
          required
        />
        <button type="submit" class="play-button">Play</button>
      </form>
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
