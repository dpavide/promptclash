<script>
  import { goto } from "$app/navigation";
  import { supabase } from "$lib/supabaseClient";
  import { onMount } from "svelte";

  let prompt = null; // The current prompt
  let response = ""; // The user's response
  let currentGameId = null; // The current game ID
  let errorMessage = "";
  let successMessage = "";

  onMount(async () => {
    // Get gameId from URL query parameters
    const urlParams = new URLSearchParams(window.location.search);
    const gameIdParam = urlParams.get("gameId");
    if (!gameIdParam) {
      alert("Game ID not found. Redirecting to waiting room.");
      goto("/waitingroom");
      return;
    }
    currentGameId = Number(gameIdParam);

    // Fetch the game record using the passed game ID
    const { data: gameData, error: gameError } = await supabase
      .from("game")
      .select("prompt_id")
      .eq("id", currentGameId)
      .single();
    if (gameError || !gameData) {
      alert("Game not found.");
      goto("/waitingroom");
      return;
    }

    // Fetch the prompt associated with the game
    const { data: fetchedPrompt, error: promptError } = await supabase
      .from("prompts")
      .select("*")
      .eq("id", gameData.prompt_id)
      .single();
    if (promptError || !fetchedPrompt) {
      console.error("Error fetching prompt:", promptError);
      goto("/waitingroom");
      return;
    }
    prompt = fetchedPrompt;
  });

  async function submitResponse() {
    try {
      // Get the current user
      const { data: user, error: userError } = await supabase.auth.getUser();
      if (userError || !user) {
        console.error("No user is signed in:", userError);
        errorMessage = "You must be logged in to submit a response.";
        return;
      }

      const userId = user.user.id;

      // Insert the response into the responses table
      const { error: insertError } = await supabase.from("responses").insert([
        {
          game_id: currentGameId,
          player_id: userId,
          text: response,
        },
      ]);

      if (insertError) {
        console.error("Error submitting response:", insertError);
        errorMessage = "Failed to submit response. Please try again.";
      } else {
        successMessage = "Response submitted successfully!";
        response = ""; // Clear the input field
        goto(`/voting?gameId=${currentGameId}`); // Redirect to the voting page with gameId
      }
    } catch (error) {
      console.error("Error in submitResponse:", error);
      errorMessage = "An error occurred. Please try again.";
    }
  }
</script>

<h1>Game</h1>

<!-- Display any messages to the user (non-blocking) -->
{#if errorMessage}
  <p style="color: red;">{errorMessage}</p>
{/if}
{#if successMessage}
  <p style="color: green;">{successMessage}</p>
{/if}

{#if prompt}
  <p>Prompt: {prompt.text}</p>
  <textarea bind:value={response} placeholder="Type your response here..."
  ></textarea>
  <button on:click={submitResponse}>Submit</button>
{:else}
  <p>Loading prompt...</p>
{/if}
