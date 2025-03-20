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
  import { error } from "@sveltejs/kit";

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

  // For subscription logic:
  let unsubscribeCount: any;
  let promptSubscription: any;
  let responseSubscription: any;
  let profilesSubscription: any = null;

  let prompt: any = null;
  let response: string = "";
  let fallbackPrompt = "Are you going to be employed?"; //Just in case the DB has no default prompts.

  let currentGame: any;
  let gameId: number | null = null;
  let userId: string | null = null;

  let errorMessage: string = "";
  let successMessage: string = "";
  let playerCount: number = 0;
  let unsubscribe: any;
  let subscription: any;

  let timeLeft = 60;
  let timerId: any = null;

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
  let ctx: CanvasRenderingContext2D | null;
  let isDrawing: boolean = false;
  let color: string = "#000000";
  let lineWidth: number = 5;
  let canvasInitialised = false;
  let resizeObserver: ResizeObserver;

  $: stage, (errorMessage = "");
  $: if (canvas && stage) {
    ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      if (!canvasInitialised) {
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        canvasInitialised = true;
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
    }
  }

  function initialiseCanvas() {
    if (canvas) {
      ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
      }
    }
  }
  async function checkForDrawingContent(): Promise<boolean> {
    if (!canvas) return false;
    const blankCanvas = document.createElement("canvas");
    blankCanvas.width = canvas.width;
    blankCanvas.height = canvas.height;
    const blankCtx = blankCanvas.getContext("2d");
    if (blankCtx) {
      blankCtx.fillStyle = "white";
      blankCtx.fillRect(0, 0, blankCanvas.width, blankCanvas.height);
      return canvas.toDataURL() !== blankCanvas.toDataURL();
    }
    return false;
  }

  async function checkProfanity(text: string): Promise<boolean> {
    try {
      console.log("Checking profanity for:", text);
      const res = await fetch(
        `https://api.api-ninjas.com/v1/profanityfilter?text=${encodeURIComponent(text)}`,
        {
          headers: {
            "X-Api-Key": "YegnxWw3X0xgvCkPMEaUCg==ugPzwG3b5VAktHVf",
          },
        }
      );

      if (!res.ok) {
        throw new Error(`API Error: ${res.status} ${await res.text()}`);
      }

      const result = await res.json();
      console.log("Profanity API result:", result);

      // Check if bad words were detected
      return result.censored;
    } catch (error) {
      console.error("Error checking profanity:", error);
      return false; // If error occurs, assume no profanity to avoid blocking submissions unfairly
    }
  }

  // Function to start the timer for a given stage.
  function startTimer() {
    clearInterval(timerId); // Clear any existing timer
    timeLeft = 60; //  Reset timer to 60 seconds
    timerId = setInterval(() => {
      timeLeft--;
      //  When time is running low, the UI will flash red (see getTimerStyle below)
      if (timeLeft <= 0) {
        clearInterval(timerId);
        forceSubmission(); // Force-submit if time runs out
      }
    }, 1000);
  }

  //Function to clear the timer manually
  function stopTimer() {
    clearInterval(timerId);
  }

  //Function to determine timer style based on timeLeft
  function getTimerStyle() {
    if (timeLeft <= 10) {
      return "color: red; animation: flash 1s infinite;";
    } else if (timeLeft <= 15) {
      return "color: orange;";
    } else if (timeLeft <= 30) {
      return "color: yellow;";
    } else {
      return "color: black;";
    }
  }

  // Force submission if timer reaches 0
  async function forceSubmission() {
    // Only force submission if still in an input stage
    if (stage === "prompt") {
      if (!promptInput.trim()) {
        await handleSubmitPrompt(true);
      } else {
        await handleSubmitPrompt(false);
      }
    } else if (stage === "response1" || stage === "response2") {
      // For responses, submit even if empty (default to "{no response given}")
      if (!responseInput.trim()) {
        responseInput = "{no response given}";
      }
      await handleSubmitTextResponse();
    }
    // No auto-action for waiting stages.
  }

  async function getImageUrl(userId: string): Promise<string> {
    const { data } = await supabase.storage
      .from("canvas_images")
      .getPublicUrl(`${userId}.png`);
    return data.publicUrl;
  }

  let players: {
    id: string;
    username?: string;
    submitted_prompt?: boolean;
    submitted_response?: boolean;
  }[] = [];

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

  async function setupPlayerCountMonitoring() {
    try {
      const { data: players, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("game_id", gameId);
      if (error) {
        console.error("Error fetching initial players:", error);
        return null;
      }
      playerCount = players.length;
      console.log(`Initial players in game ${gameId}:`, playerCount);

      // Return the cleanup function directly
      return monitorPlayerCount(
        gameId,
        () => {
          /* onReady callback */
        },
        (newCount: number) => {
          playerCount = newCount;
        }
      );
    } catch (error) {
      console.error("Error setting up player count monitoring:", error);
      return null;
    }
  }

  function subscribeToPromptSubscriptions() {
    const channel = supabase
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
          if (stage === "prompt" || stage === "waitingPrompt") {
            await checkIfAllSubmittedPrompts();
          }
        }
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
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
      startTimer();
    }
  }

  // Submit the user's prompt or default
  async function handleSubmitPrompt(useDefault: boolean) {
    stopTimer();
    errorMessage = "";

    if (!userId) {
      errorMessage = "No user is signed in.";
      return;
    }
    const typedPrompt = useDefault ? "" : promptInput.trim();
    try {
      const promptToSubmit = useDefault
        ? ""
        : await checkProfanity(typedPrompt);
      await submitPlayerPrompt(gameId, userId, promptToSubmit);
      const { error } = await supabase
        .from("profiles")
        .update({ submitted_prompt: true })
        .eq("id", userId);
      if (error) {
        console.error("Error marking submitted_prompt:", error);
      }
      stage = "waitingPrompt";
    } catch (err) {
      console.error("Error submitting prompt:", err);
      errorMessage = "Failed to submit prompt. Please try again.";
    }
  }

  async function assignPromptsForCurrentUser() {
    try {
      const { data: allPrompts, error: pErr } = await supabase
        .from("prompts")
        .select("id, text, player_id")
        .eq("game_id", gameId);
      if (pErr || !allPrompts) {
        errorMessage = "Error fetching prompts for assignment.";
        return;
      }

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

  async function handleSubmitTextResponse() {
    stopTimer();
    errorMessage = "";

    if (!assignedPrompts || assignedPrompts.length === 0) {
      errorMessage = "No assigned prompts found.";
      return;
    }
    if (!userId) {
      errorMessage = "No user is signed in.";
      return;
    }

    // Text-specific validation
    if (!responseInput.trim()) {
      errorMessage = "Text response cannot be empty.";
      return;
    }

    const targetPrompt = assignedPrompts[responseIndex];
    if (!targetPrompt) {
      errorMessage = "Could not find the assigned prompt to answer.";
      return;
    }
    const profanityCheckedAnswer = await checkProfanity(responseInput);
    try {
      await submitResponse(
        gameId,
        userId,
        targetPrompt.id,
        profanityCheckedAnswer
      );
      responseInput = "";
      errorMessage = "";

      if (responseIndex === 0 && assignedPrompts.length > 1) {
        responseIndex = 1;
        stage = "response2";
        successMessage =
          "Ok you answered that first prompt. Now answer another one!";
        startTimer();
      } else {
        stage = "waitingResponse";
        successMessage = "You answered both prompts. Waiting for others...";
        await supabase
          .from("profiles")
          .update({ submitted_response: true })
          .eq("id", userId);
      }
    } catch (err) {
      console.error("Error submitting text response:", err);
      errorMessage = "Failed to submit text response. Please try again.";
    }
  }

  async function handleSubmitDrawingResponse() {
    stopTimer();
    errorMessage = "";
    const hasDrawing = await checkForDrawingContent();

    if (!assignedPrompts || assignedPrompts.length === 0) {
      errorMessage = "No assigned prompts found.";
      return;
    }
    if (!userId) {
      errorMessage = "No user is signed in.";
      return;
    }
    if (!hasDrawing) {
      errorMessage = "Drawing cannot be empty";
      return;
    }

    const targetPrompt = assignedPrompts[responseIndex];
    if (!targetPrompt) {
      errorMessage = "Could not find the assigned prompt to answer.";
      return;
    }

    try {
      // Convert canvas to PNG
      const canvasImage = canvas.toDataURL("image/png");
      const fileBlob = dataURLtoBlob(canvasImage);

      // Generate unique filename
      const fileName = `${userId}-${targetPrompt.id}.png`;

      // Upload to Supabase storage
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("canvas-images")
        .upload(fileName, fileBlob, {
          upsert: true,
          contentType: "image/png",
        });

      if (uploadError) {
        console.error("Upload error details:", uploadError);
        throw uploadError;
      }

      // Get public URL from upload response
      const imageUrl = uploadData?.path
        ? supabase.storage.from("canvas-images").getPublicUrl(uploadData.path)
            .data.publicUrl
        : null;

      if (!imageUrl) throw new Error("Failed to get image URL");

      // Submit response with image URL
      await submitResponse(gameId, userId, targetPrompt.id, imageUrl);

      // Clear and progress
      responseInput = "";
      errorMessage = "";

      if (responseIndex === 0 && assignedPrompts.length > 1) {
        responseIndex = 1;
        stage = "response2";
        successMessage =
          "Ok you answered that first prompt. Now answer another one!";
        startTimer();
      } else {
        stage = "waitingResponse";
        successMessage = "You answered both prompts. Waiting for others...";
        await supabase
          .from("profiles")
          .update({ submitted_response: true })
          .eq("id", userId);
      }
    } catch (err) {
      console.error("Error submitting drawing:", err);
      errorMessage =
        "Failed to submit drawing. Please check console for details.";
    }
  }

  // Helper function to convert data URL to Blob
  function dataURLtoBlob(dataURL: string) {
    const arr = dataURL.split(",");
    const mime = arr[0].match(/:(.*?);/)![1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
  }
  function startDrawing(event: MouseEvent) {
    if (!ctx || !canvas) return;
    isDrawing = true;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    const rect = (event.target as HTMLCanvasElement).getBoundingClientRect();
    ctx.beginPath();
    ctx.moveTo(event.clientX - rect.left, event.clientY - rect.top);
  }

  function draw(event: MouseEvent) {
    if (!isDrawing || !ctx || !canvas) return;
    ctx.restore();
    const rect = (event.target as HTMLCanvasElement).getBoundingClientRect();
    ctx.lineTo(event.clientX - rect.left, event.clientY - rect.top);
    ctx.stroke();
    ctx.save();
  }

  function stopDrawing() {
    isDrawing = false;
  }

  function clearCanvas() {
    if (ctx && canvas) {
      ctx.fillStyle = "white";
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  function handleMouseDown(event: MouseEvent) {
    if (!ctx) return;
    isDrawing = true;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    const rect = (event.target as HTMLCanvasElement).getBoundingClientRect();
    ctx.beginPath();
    ctx.moveTo(event.clientX - rect.left, event.clientY - rect.top);
  }
  function handleMouseMove(event: MouseEvent) {
    if (!isDrawing || !ctx) return;
    const rect = (event.target as HTMLCanvasElement).getBoundingClientRect();
    ctx.lineTo(event.clientX - rect.left, event.clientY - rect.top);
    ctx.stroke();
  }
  function handleMouseUp(event: MouseEvent) {
    isDrawing = false;
  }
  function handleMouseLeave(event: MouseEvent) {
    isDrawing = false;
  }

  function submitDrawing() {
    if (!ctx || !canvas) return;
    handleSubmitDrawingResponse();
  }

  async function fetchPlayersAndSubscribe() {
    await fetchPlayers();
    const unsubscribePlayers = subscribeToPlayerUpdates();
    return unsubscribePlayers;
  }

  async function fetchPlayers() {
    const { data: profilesData, error } = await supabase
      .from("profiles")
      .select("id, username, submitted_prompt, submitted_response")
      .eq("game_id", gameId);
    if (error) {
      console.error("Error fetching players:", error);
    } else {
      players = profilesData || [];
    }
  }

  function subscribeToPlayerUpdates() {
    const channel = supabase
      .channel("profile-changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "profiles",
          filter: `game_id=eq.${gameId}`,
        },
        async () => {
          await fetchPlayers();
        }
      )
      .subscribe();
    return () => supabase.removeChannel(channel);
  }

  function getPlayerImage(player, index) {
    if (stage === "prompt" || stage === "waitingPrompt") {
      return player.submitted_prompt
        ? playerIdleImages[index]
        : playerWriteImages[index];
    } else if (
      stage === "response1" ||
      stage === "response2" ||
      stage === "waitingResponse"
    ) {
      return player.submitted_response
        ? playerIdleImages[index]
        : playerWriteImages[index];
    }
    return playerWriteImages[index];
  }

  onMount(async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const gameIdParam = urlParams.get("gameId");
    if (!gameIdParam) {
      alert("No game ID provided. Redirecting to waiting room.");
      goto("/waitingroom");
      return;
    }
    gameId = Number(gameIdParam);

    const { data: sessionData, error: sessionError } =
      await supabase.auth.getSession();
    userId = sessionData?.session?.user?.id || null;
    if (sessionError || !userId) {
      errorMessage = "No user is signed in.";
    }

    currentGame = await fetchGame();
    await fetchPlayers();

    // Setup subscriptions
    const countCleanup = await setupPlayerCountMonitoring();
    const promptCleanup = subscribeToPromptSubscriptions();
    const responseCleanup = subscribeToResponseSubmissions();
    const playersCleanup = subscribeToPlayerUpdates();

    await checkIfAllSubmittedPrompts();
    await checkIfAllSubmittedResponses();

    resizeObserver = new ResizeObserver((entries) => {
      if (canvas) {
        // Maintain 1:1 pixel ratio
        canvas.width = 420;
        canvas.height = 200;
      }
    });

    if (canvas) {
      resizeObserver.observe(canvas);
    }

    if (stage === "prompt" || stage === "response1" || stage === "response2") {
      startTimer();
    }

    onDestroy(() => {
      clearInterval(timerId);
      if (countCleanup) countCleanup();
      promptCleanup();
      responseCleanup();
      playersCleanup();
    });
  });

  onDestroy(() => {
    if (unsubscribeCount && typeof unsubscribeCount === "function") {
      unsubscribeCount();
    }
    if (resizeObserver) {
      resizeObserver.disconnect();
    }
  });

  function subscribeToResponseSubmissions() {
    const channel = supabase
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
    return () => supabase.removeChannel(channel);
  }

  async function checkIfAllSubmittedResponses() {
    const { data: players, error: e1 } = await supabase
      .from("profiles")
      .select("id")
      .eq("game_id", gameId);
    if (e1 || !players) {
      console.error("Error fetching players:", e1);
      return;
    }
    const totalPlayers = players.length;

    const { data: allResponses, error: e2 } = await supabase
      .from("responses")
      .select("player_id")
      .eq("game_id", gameId);
    if (e2 || !allResponses) {
      console.error("Error fetching responses:", e2);
      return;
    }

    const counts: Record<string, number> = {};
    for (const r of allResponses) {
      counts[r.player_id] = (counts[r.player_id] || 0) + 1;
    }

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
      goto(`/voting?gameId=${gameId}&promptIndex=0`);
    }
  }
</script>

<div class="game-container">
  <!-- NEW container that holds the background image and the prompt overlay -->
  <div class="background-container">
    <div class="background-container">
      <div class="animated-background"></div>

      <!-- Now the prompt-wrapper is nested INSIDE the background image container -->
      <div class="prompt-wrapper">
        {#if errorMessage}
          <p class="error">{errorMessage}</p>
        {/if}

        {#if stage === "prompt"}
          <div class="prompt-container">
            <p>Write your own prompt or use a default:</p>
            <input
              type="text"
              bind:value={promptInput}
              placeholder="Type something..."
            />
            <div class="button-group" style="margin-top: 1rem;">
              <button on:click={() => handleSubmitPrompt(false)}  style="background-color: #0077cc; color: white; padding: 10px 20px; border-radius: 8px; border: none; cursor: pointer; font-size: 1rem;">
                Submit Prompt
              </button>
              <button on:click={() => handleSubmitPrompt(true)}  style="background-color: #0077cc; color: white; padding: 10px 20px; border-radius: 8px; border: none; cursor: pointer; font-size: 1rem;">
                Use Default Prompt
              </button>
            </div>
            <p style={getTimerStyle()}>Time left: {timeLeft}s</p>
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
              <div class="response-area">
                <div class="text-area-wrapper">
                  <textarea
                    bind:value={responseInput}
                    placeholder="Type your response for prompt #1..."
                  ></textarea>
                  <!-- MOVED SUBMIT BUTTON HERE -->
                  <div class="text-submit-wrapper">
                    <button on:click={handleSubmitTextResponse} style="background-color: #0077cc; color: white; padding: 10px 20px; border-radius: 8px; border: none; cursor: pointer; font-size: 1rem;"
                      >Submit Text Response</button
                    >
                    <p style={getTimerStyle()}>Time left: {timeLeft}s</p>
                  </div>
                </div>
                <div class="drawing-area">
                  <p>Or draw your response:</p>
                  <canvas
                    data-key={stage}
                    bind:this={canvas}
                    width="420"
                    height="200"
                    on:mousedown={handleMouseDown}
                    on:mousemove={handleMouseMove}
                    on:mouseup={handleMouseUp}
                    on:mouseleave={handleMouseLeave}
                  ></canvas>
                  <div class="controls">
                    <label>
                      Color: <input type="color" bind:value={color} />
                    </label>
                    <label>
                      Size:
                      <input
                        type="range"
                        min="1"
                        max="20"
                        step="1"
                        bind:value={lineWidth}
                      />
                      {lineWidth}px
                    </label>
                    <button on:click={clearCanvas}  style="background-color: #0077cc; color: white; padding: 10px 20px; border-radius: 8px; border: none; cursor: pointer; font-size: 1rem;">
                      Clear
                    </button>
                    <button on:click={submitDrawing} style="background-color: #0077cc; color: white; padding: 10px 20px; border-radius: 8px; border: none; cursor: pointer; font-size: 1rem;">
                      Submit Drawing
                    </button>
                  </div>
                </div>
              </div>
            </div>
          {:else}
            <p>Loading assigned prompts...</p>
          {/if}
        {:else if stage === "response2"}
          {#if assignedPrompts.length > 1}
            <div class="prompt-container">
              <p><strong>Prompt #2</strong>:</p>
              <p><em>{assignedPrompts[1].text}</em></p>
              <div class="response-area">
                <div class="text-area-wrapper">
                  <textarea
                    bind:value={responseInput}
                    placeholder="Type your response..."
                  ></textarea>
                  <!-- MOVED SUBMIT BUTTON HERE -->
                  <div class="text-submit-wrapper">
                    <button on:click={handleSubmitTextResponse}
                      >Submit Text Response</button
                    >
                    <p style={getTimerStyle()}>Time left: {timeLeft}s</p>
                  </div>
                </div>
                <div class="drawing-area">
                  <p>Or draw your response:</p>
                  <canvas
                    data-key={stage}
                    bind:this={canvas}
                    width="420"
                    height="200"
                    on:mousedown={handleMouseDown}
                    on:mousemove={handleMouseMove}
                    on:mouseup={handleMouseUp}
                    on:mouseleave={handleMouseLeave}
                  ></canvas>
                  <div class="controls">
                    <label>
                      Color: <input type="color" bind:value={color} />
                    </label>
                    <label>
                      Size:
                      <input
                        type="range"
                        min="1"
                        max="20"
                        step="1"
                        bind:value={lineWidth}
                      />
                      {lineWidth}px
                    </label>
                    <button on:click={clearCanvas}>Clear</button>
                    <button on:click={submitDrawing}>Submit Drawing</button>
                  </div>
                </div>
              </div>
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
    </div>
  </div>

  <!-- Players container remains outside -->
  <div class="players">
    {#each players.sort((a, b) => a.id.localeCompare(b.id)) as player, i}
      <img src={getPlayerImage(player, i)} alt="Player" class="player" />
    {/each}
  </div>
</div>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    overflow:hidden;
  }
  .game-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    background-color: #078fd8;
  }

  .background-container {
    position: relative;
    width: 100%;
    max-width: 1600px;
    margin: 10px auto;
    aspect-ratio: 1.5;
  }

  .animated-background {
    width: 100%;
    height: 100%;
    border-radius: 10px;
    background-size: contain;
    background-repeat: no-repeat;
    background-position: center;
    animation: bgAnimation 1s infinite ease-in-out;
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
    position: absolute;
    top: 40%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 90%;
    max-width: 800px;
    z-index: 2;
  }

  .prompt-container {
    font-size: 1em;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 15px;
  }

  .response-area {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 30px;
    width: 100%;
    min-width: 700px;
    align-items: start;
  }

  .text-area-wrapper {
    min-width: 300px;
    display: flex;
    flex-direction: column;
    gap: 15px;
  }

  .text-area-wrapper textarea {
    width: 100%;
    height: 200px;
    min-height: 200px;
    padding: 10px;
    border: 1px solid #ddd;
    border-radius: 8px;
    resize: vertical;
    box-sizing: border-box;
  }

  .text-submit-wrapper {
    margin-top: 10px;
    text-align: left;
  }

  .text-submit-wrapper button {
    display: inline-block;
    margin: 0;
    padding: 10px 20px;
    font-size: 1rem;
    background-color: #0077cc;
    color: white;
    border: none;
    border-radius: 8px;
    cursor: pointer;
  }

  .text-submit-wrapper button:hover {
    background-color: #005fa3;
  }

  .drawing-area {
    margin-left: 20px;
    width: 100%;
    height: auto;
    min-height: 250px;
    background: white;
    border: 2px solid #000;
    padding: 10px;
    position: relative;
  }

  .drawing-area canvas {
    width: 100%;
    height: 200px;
    cursor: crosshair;
    display: block;
    margin-bottom: 15px;
  }

  .controls {
    position: relative;
    z-index: 2;
    margin-top: 15px;
    gap: 12px;
    padding: 10px;
    background: rgba(255, 255, 255, 0.9);
    border-radius: 8px;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
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
    z-index: 1;
  }

  .player {
    width: 12vw;
    height: 12vw;
    max-width: 150px;
    max-height: 150px;
    margin: 0;
  }

  .error {
    color: red;
  }

  .success {
    color: green;
  }

  @keyframes flash {
    0% {
      opacity: 1;
    }
    50% {
      opacity: 0.3;
    }
    100% {
      opacity: 1;
    }
  }
</style>
