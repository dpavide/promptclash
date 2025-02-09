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

<h1>Login</h1>

<form on:submit|preventDefault={handleAnonymousSignIn}>
  <input
    type="text"
    bind:value={username}
    placeholder="Enter your username"
    required
  />
  <button type="submit">Join Game</button>
</form>

<style>
  form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    max-width: 300px;
    margin: 0 auto;
  }

  input {
    padding: 0.5rem;
    font-size: 1rem;
    border: 1px solid #ccc;
    border-radius: 4px;
  }

  button {
    padding: 0.5rem;
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
</style>
