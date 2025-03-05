<script lang="ts">
  import { goto } from "$app/navigation";
  import { supabase } from "$lib/supabaseClient";
  import { onMount, onDestroy, tick } from "svelte";
  import {
    monitorPlayerCount,
    submitPlayerPrompt,
    fetchGamePrompts,
    submitResponse,
  } from "$lib/api";

  // We'll define five stages:
  // 1) "prompt"
  // 2) "waitingPrompt"
  // 3) "response1"
  // 4) "response2"
  // 5) "waitingResponse"
  // Then we redirect to /voting when all players have 2 responses in 'responses' table.

  let stage:
    | "prompt"
    | "waitingPrompt"
    | "response1"
    | "response2"
    | "waitingResponse" = "prompt";

  // For the prompt-writing phase:
  let promptInput = "";

  // For the response phase:
  let assignedPrompts: any[] = [];
  let assignedPrompt: any = null;
  let responseInput = "";
  let responseIndex = 0;
  let allSubmitted = false;
  let iHaveSubmitted = false;

  // For subscription logic:
  let unsubscribeCount: any;
  let promptSubscription: any;
  let responseSubscription: any;
  let profilesSubscription: any = null;

  let prompt: any = null;
  let response: string = "";
  let fallbackPrompt = "Are you going to be employed?"; //Just in case the DB has no default promtps.

  let currentGame: any;
  let gameId: number | null = null;
  let userId: string | null = null;

  let errorMessage: string = "";
  let successMessage: string = "";
  let playerCount: number = 0;
  let unsubscribe: any;
  let subscription: any;

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

  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D;
  let isDrawing: boolean = false;
  let color: string = "#000000";
  let lineWidth: number = 5;

  // NEW: players array – we fetch player ids (and usernames) from the database to determine join order
  let players: { id: string; username?: string }[] = [];

  async function fetchGame() {
    const { data: gameData, error: gameError } = await supabase
      .from("game")
      .select("prompt_id")
      .eq("id", gameId)
      .single();
    if (gameError || !gameData) {
      console.error("Error fetching game:", gameError);
      goto("/");
      return null;
    }
    return gameData;
  }

  async function fetchPrompt(promptId: number) {
    const { data: fetchedPrompt, error: promptError } = await supabase
      .from("prompts")
      .select("*")
      .eq("id", promptId)
      .single();
    if (promptError || !fetchedPrompt) {
      console.error("Error fetching prompt:", promptError);
      goto("/");
      return null;
    }
    return fetchedPrompt;
  }

  async function setupPlayerCountMonitoring() {
    try {
      const { data: players, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("game_id", gameId);
      if (error) {
        console.error("Error fetching initial players:", error);
        return;
      }
      playerCount = players.length;
      console.log(`Initial players in game ${gameId}:`, playerCount);

      // Subscribe to player count changes without automatic redirect
      unsubscribe = monitorPlayerCount(
        gameId,
        () => {
          // Removed automatic redirect to prevent interference with voting screen navigation
        },
        (newCount: number) => {
          playerCount = newCount;
        }
      );
    } catch (error) {
      console.error("Error setting up player count monitoring:", error);
    }
  }

  function subscribeToPromptSubmissions() {
    promptSubscription = supabase
      .channel("prompt-submissions")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "profiles",
          filter: `game_id=eq.${gameId}`,
        },
        async () => {
          await checkIfAllSubmittedPrompts();
        }
      )
      .subscribe();
  }

  // check if all players have submitted_prompt = true
  async function checkIfAllSubmittedPrompts() {
    const { data: players, error } = await supabase
      .from("profiles")
      .select("id, submitted_prompt")
      .eq("game_id", gameId);
    if (error || !players) return;

    const total = players.length;
    const submittedCount = players.filter((p) => p.submitted_prompt).length;
    console.log(`Prompt stage: total=${total}, submitted=${submittedCount}`);
    if (submittedCount === total) {
      // all have prompts => assign 2 prompts for each user
      await assignPromptsForCurrentUser();
      stage = "response1";
      successMessage =
        "All players have submitted prompts! Please answer your first assigned prompt.";
    }
  }

  /**
   * handleSubmitPrompt(useDefault: boolean)
   * - If useDefault is true, we pass an empty string so the API picks one of your default prompts.
   * - Otherwise, we use the text typed by the user.
   * After submitting, we fetch all prompts, assign the next prompt (cyclically) that isn’t the user's own,
   * and then switch the stage to "waiting", then to stage "response" once all others have added their prompts.
   */
  // Submit the user's prompt or default
  async function handleSubmitPrompt(useDefault: boolean) {
    errorMessage = "";
    if (!userId) {
      errorMessage = "No user is signed in.";
      return;
    }
    const typedPrompt = useDefault ? "" : promptInput.trim();
    try {
      await submitPlayerPrompt(gameId, userId, typedPrompt);
      // mark user => submitted_prompt = true
      const { error } = await supabase
        .from("profiles")
        .update({ submitted_prompt: true })
        .eq("id", userId);
      if (error) {
        console.error("Error marking submitted_prompt:", error);
      }
      // switch to waitingPrompt
      stage = "waitingPrompt";
    } catch (err) {
      console.error("Error submitting prompt:", err);
      errorMessage = "Failed to submit prompt. Please try again.";
    }
  }

  async function assignPromptsForCurrentUser() {
    try {
      // fetch all prompts
      const { data: allPrompts, error: pErr } = await supabase
        .from("prompts")
        .select("id, text, player_id")
        .eq("game_id", gameId);
      if (pErr || !allPrompts) {
        errorMessage = "Error fetching prompts for assignment.";
        return;
      }

      // fetch all players
      const { data: allPlayers, error: plErr } = await supabase
        .from("profiles")
        .select("id")
        .eq("game_id", gameId);
      if (plErr || !allPlayers) {
        errorMessage = "Error fetching players for assignment.";
        return;
      }
      allPlayers.sort((a, b) => a.id.localeCompare(b.id));
      const n = allPlayers.length;
      const index = allPlayers.findIndex((p) => p.id === userId);
      if (index === -1) {
        errorMessage = "User not found among players.";
        return;
      }

      // For each prompt i, the 2 responders are (i+1)%n, (i+2)%n
      // So each user i is assigned the prompts from (i-1)%n and (i-2)%n
      // Or simpler: we do user i answers from (i+1)%n and (i+2)%n
      const owner1 = allPlayers[(index + 1) % n].id;
      const owner2 = allPlayers[(index + 2) % n].id;

      allPrompts.sort((a, b) => a.id - b.id);

      const p1 = allPrompts.find((pr) => pr.player_id === owner1);
      const p2 = allPrompts.find((pr) => pr.player_id === owner2);

      assignedPrompts = [];
      if (p1) assignedPrompts.push(p1);
      if (p2) assignedPrompts.push(p2);

      console.log("Assigned prompts for user", userId, ":", assignedPrompts);
    } catch (err) {
      console.error("Error in assignPromptsForCurrentUser:", err);
    }
  }

  async function handleSubmitResponse() {
    if (!assignedPrompts || assignedPrompts.length === 0) {
      errorMessage = "No assigned prompts found.";
      return;
    }
    if (!userId) {
      errorMessage = "No user is signed in.";
      return;
    }
    // The user is responding to assignedPrompts[responseIndex].
    const targetPrompt = assignedPrompts[responseIndex];
    if (!targetPrompt) {
      errorMessage = "Could not find the assigned prompt to answer.";
      return;
    }
    try {
      // 1) Submit the response
      await submitResponse(gameId, userId, targetPrompt.id, responseInput);
      // 2) Clear the input
      responseInput = "";

      // if we are on the first prompt => move on to second
      if (responseIndex === 0 && assignedPrompts.length > 1) {
        responseIndex = 1;
        stage = "response2";
        successMessage =
          "Ok you answered that first prompt. Now answer another one!";
      } else {
        // user answered second prompt => done
        stage = "waitingResponse";
        successMessage = "You answered both prompts. Waiting for others...";
      }
    } catch (err) {
      console.error("Error submitting response:", err);
      errorMessage = "Failed to submit response. Please try again.";
    }
  }

  async function submitResponseForDrawing(img: string) {
    try {
      const { data: user, error: userError } = await supabase.auth.getUser();
      if (userError || !user) {
        console.error("No user is signed in:", userError);
        return;
      }
      const userId = user.user.id;

      const { error: insertError } = await supabase.from("responses").insert([
        {
          game_id: gameId,
          player_id: userId,
          drawing: img,
        },
      ]);

      if (insertError) {
        console.error("Error submitting drawing:", insertError);
      } else {
        response = "";
        goto(`/voting?gameId=${gameId}`);
      }
    } catch (error) {
      console.error("Error in submitResponseForDrawing:", error);
    }
  }

  function startDrawing(event: MouseEvent) {
    if (!ctx) return;
    isDrawing = true;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    const rect = (event.target as HTMLCanvasElement).getBoundingClientRect();
    ctx.beginPath();
    ctx.moveTo(event.clientX - rect.left, event.clientY - rect.top);
  }

  function draw(event: MouseEvent) {
    if (!isDrawing || !ctx) return;
    const rect = (event.target as HTMLCanvasElement).getBoundingClientRect();
    ctx.lineTo(event.clientX - rect.left, event.clientY - rect.top);
    ctx.stroke();
  }

  function stopDrawing() {
    isDrawing = false;
  }

  function clearCanvas() {
    if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  function submitDrawing() {
    if (!ctx || !canvas) return;
    const canvasImage = canvas.toDataURL("image/png");
    submitResponseForDrawing(canvasImage);
    console.log("Drawing saved to database:", canvasImage);
  }

  // NEW: fetch the players (only id and username) to determine join order for images
  async function fetchPlayers() {
    const { data: profilesData, error } = await supabase
      .from("profiles")
      .select("id, username")
      .eq("game_id", gameId);
    if (error) {
      console.error("Error fetching players:", error);
    } else {
      players = profilesData || [];
    }
  }

  onMount(async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const gameIdParam = urlParams.get("gameId");
    if (!gameIdParam) {
      alert("No game ID provided. Redirecting to waiting room.");
      goto("/");
      return;
    }
    gameId = Number(gameIdParam);

    const { data: sessionData, error: sessionError } =
      await supabase.auth.getSession();
    userId = sessionData?.session?.user?.id || null;
    if (sessionError || !userId) {
      errorMessage = "No user is signed in.";
    }

    // // subscribe to changes in profiles => see if all players have submitted
    // subscription = supabase
    //   .channel("prompt-submissions")
    //   .on(
    //     "postgres_changes",
    //     {
    //       event: "*",
    //       schema: "public",
    //       table: "profiles",
    //       filter: `game_id=eq.${gameId}`
    //     },
    //     async () => {
    //       await checkIfAllSubmittedResponse();
    //     }
    //   )
    //   .subscribe();

    // also do an initial check
    // await checkIfAllSubmittedResponse();

    currentGame = await fetchGame();
    setupPlayerCountMonitoring();

    //subscribe to changes in profiles => checkIfAllSubmittedPrompts
    subscribeToPromptSubmissions();
    await checkIfAllSubmittedPrompts();

    subscribeToResponseSubmissions();
    await checkIfAllSubmittedResponses();

    // NEW: fetch players so we can determine join order for images
    await fetchPlayers();

    await tick();
    let tries = 10;
    while (!canvas && tries > 0) {
      console.log("Waiting for canvas...");
      await new Promise((r) => setTimeout(r, 100));
      tries--;
    }
    if (canvas) {
      ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        console.log("Canvas initialized successfully:", ctx);
      }
    } else {
      console.error("Canvas still not available!");
    }
  });

  onDestroy(() => {
    if (unsubscribeCount) {
      if (typeof unsubscribeCount.unsubscribe === "function") {
        unsubscribe.unsubscribe();
      } else if (typeof unsubscribeCount === "function") {
        unsubscribeCount();
      }
    }
    if (promptSubscription) supabase.removeChannel(promptSubscription);
    if (responseSubscription) supabase.removeChannel(responseSubscription);
  });

  // subscribe => each time a user updates 'responses', we check if all are done
  // subscribe => each time a user updates 'responses', we check if all are done
  function subscribeToResponseSubmissions() {
    responseSubscription = supabase
      .channel("response-submissions")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "responses",
          filter: `game_id=eq.${gameId}`,
        },
        async () => {
          await checkIfAllSubmittedResponses();
        }
      )
      .subscribe();
  }

  // check if all players have submitted_response = true
  async function checkIfAllSubmittedResponses() {
    // 1) fetch all players
    const { data: players, error: e1 } = await supabase
      .from("profiles")
      .select("id")
      .eq("game_id", gameId);
    if (e1 || !players) {
      console.error("Error fetching players:", e1);
      return;
    }
    const totalPlayers = players.length;

    // 2) fetch all responses
    const { data: allResponses, error: e2 } = await supabase
      .from("responses")
      .select("player_id")
      .eq("game_id", gameId);
    if (e2 || !allResponses) {
      console.error("Error fetching responses:", e2);
      return;
    }

    // 3) build a map: how many responses each user has
    const counts: Record<string, number> = {};
    for (const r of allResponses) {
      counts[r.player_id] = (counts[r.player_id] || 0) + 1;
    }

    // 4) check if each user has at least 2
    let doneCount = 0;
    for (const p of players) {
      if ((counts[p.id] || 0) >= 2) {
        doneCount++;
      }
    }

    console.log(
      `Response stage: total=${totalPlayers}, responded2=${doneCount}`
    );
    if (doneCount === totalPlayers) {
      // all players have 2 responses => go to /voting
      goto(`/voting?gameId=${gameId}&promptIndex=0`);
    }
  }
</script>

<div class="game-container">
  <img src="backgrounds/bgstart.png" alt="Background" class="backgroundbox" />
  <div class="prompt-wrapper">
    {#if errorMessage}
      <p class="error">{errorMessage}</p>
    {/if}
    <!-- {#if successMessage}
      <p class="success">{successMessage}</p>
    {/if} -->

    {#if stage === "prompt"}
      <!-- user picks or types a prompt -->
      <div class="prompt-container">
        <p>Write your own prompt or use a default:</p>
        <input
          type="text"
          bind:value={promptInput}
          placeholder="(Optional) Type your prompt..."
        />
        <div class="button-group" style="margin-top: 1rem;">
          <button on:click={() => handleSubmitPrompt(false)}
            >Submit Prompt</button
          >
          <button on:click={() => handleSubmitPrompt(true)}
            >Use Default Prompt</button
          >
        </div>
      </div>
    {:else if stage === "waitingPrompt"}
      <div class="prompt-container">
        <h2>Prompt submitted!</h2>
        <p>Waiting for other players to submit their prompts...</p>
      </div>
    {:else if stage === "response1"}
      {#if assignedPrompts.length > 0}
        <div class="prompt-container">
          <p><strong>Prompt #1</strong>:</p>
          <p><em>{assignedPrompts[0].text}</em></p>
          <textarea
            bind:value={responseInput}
            placeholder="Type your response for prompt #1..."
          ></textarea>
          <button on:click={handleSubmitResponse}>Submit Response</button>
        </div>
      {:else}
        <p>Loading assigned prompts...</p>
      {/if}
    {:else if stage === "response2"}
      {#if assignedPrompts.length > 1}
        <div class="prompt-container">
          <p><strong>Prompt #2</strong>:</p>
          <p><em>{assignedPrompts[1].text}</em></p>
          <textarea
            bind:value={responseInput}
            placeholder="Type your response..."
          ></textarea>
          <button on:click={handleSubmitResponse}>Submit Response</button>
        </div>
      {:else}
        <p>Loading second prompt...</p>
      {/if}
    {:else if stage === "waitingResponse"}
      <div class="prompt-container">
        <h2>You answered both prompts!</h2>
        <p>Waiting for other players to finish responding...</p>
      </div>
    {/if}
  </div>

  <!-- NEW: Display players with images based on local state.
       For the current user, if stage is waitingPrompt or waitingResponse, we use the idle image;
       all other players use the writing image.
       Join order is determined by sorting the players by id. -->
  <div class="players">
    {#each players.sort((a, b) => a.id.localeCompare(b.id)) as player, i}
      <img
        src={player.id === userId &&
        (stage === "waitingPrompt" || stage === "waitingResponse")
          ? playerIdleImages[i]
          : playerWriteImages[i]}
        alt="Player"
        class="player"
      />
    {/each}
  </div>
</div>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
  }
  .game-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    background-color: #078fd8;
  }
  .backgroundbox {
    width: 80%;
    height: 60%;
    background-size: cover;
    background-position: center;
    border-radius: 12px;
    margin-top: 10px;
    animation: bgAnimation 1s infinite;
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
  .prompt-wrapper {
    align-items: center;
    justify-content: center;
    position: absolute;
    top: 35%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 60%;
    max-width: 500px;
  }
  .prompt-container {
    font-size: 1em;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 15px;
  }
  textarea {
    width: 95%;
    height: 50px;
    margin: 10px 0;
    padding: 10px;
    border: 1px solid #ddd;
    border-radius: 8px;
    resize: none;
  }
  button {
    padding: 10px 15px;
    background-color: #0077cc;
    color: white;
    border: none;
    border-radius: 8px;
    cursor: pointer;
  }
  button:hover {
    background-color: #005fa3;
  }
  .players {
    display: flex;
    justify-content: center;
    align-items: center;
    flex-wrap: wrap;
    padding: 0;
    position: fixed;
    bottom: 0;
    left: 0;
    width: 100vw;
  }
  .player {
    width: 12vw;
    height: 12vw;
    max-width: 150px;
    max-height: 150px;
    margin: 0;
  }
  canvas {
    border: 2px solid black;
    cursor: crosshair;
  }
  .controls {
    margin-top: 10px;
    display: flex;
    gap: 10px;
    align-items: center;
  }
  .error {
    color: red;
  }
  .success {
    color: green;
  }
  /* 
  <div class="drawing-section">
    <p>Or draw your response:</p>
    <canvas
      bind:this={canvas}
      width="420"
      height="200"
      on:mousedown={startDrawing}
      on:mousemove={draw}
      on:mouseup={stopDrawing}
      on:mouseleave={stopDrawing}
    ></canvas>
    <div class="controls">
      <label>Color: <input type="color" bind:value={color} /></label>
      <label>Size:
        <input type="range" min="1" max="20" step="1" bind:value={lineWidth} />
        {lineWidth}px
      </label>
      <button on:click={clearCanvas}>Clear</button>
      <button on:click={submitDrawing}>Submit Drawing</button>
    </div>
  </div>
  */
</style>
