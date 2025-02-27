<script lang="ts">
  import { goto } from "$app/navigation";
  import { supabase } from "$lib/supabaseClient";
  import { onMount, onDestroy, tick } from "svelte";
  import { monitorPlayerCount } from "$lib/api";

  let prompt: any = null;
  let response: string = "";
  let currentGameId: number | null = null;
  let errorMessage: string = "";
  let successMessage: string = "";
  let playerCount: number = 0;
  let unsubscribe: any;
  let currentGame: any;

  let playerimages: string[] = [
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

  async function fetchGame() {
    const { data: gameData, error: gameError } = await supabase
      .from("game")
      .select("prompt_id")
      .eq("id", currentGameId)
      .single();
    if (gameError || !gameData) {
      console.error("Error fetching game:", gameError);
      goto("/waitingroom");
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
      goto("/waitingroom");
      return null;
    }
    return fetchedPrompt;
  }

  async function setupPlayerCountMonitoring() {
    try {
      const { data: players, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("game_id", currentGameId);
      if (error) {
        console.error("Error fetching initial players:", error);
        return;
      }
      playerCount = players.length;
      console.log(`Initial players in game ${currentGameId}:`, playerCount);

      // Subscribe to player count changes without automatic redirect
      unsubscribe = monitorPlayerCount(
        currentGameId,
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

  async function submitResponse() {
    try {
      errorMessage = "";
      successMessage = "";
      const { data: user, error: userError } = await supabase.auth.getUser();
      if (userError || !user) {
        console.error("No user is signed in:", userError);
        errorMessage = "You must be logged in to submit a response.";
        return;
      }
      const userId = user.user.id;

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
        response = "";
        goto(`/voting?gameId=${currentGameId}`);
      }
    } catch (error) {
      console.error("Error in submitResponse:", error);
      errorMessage = "An error occurred. Please try again.";
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
          game_id: currentGameId,
          player_id: userId,
          drawing: img,
        },
      ]);

      if (insertError) {
        console.error("Error submitting drawing:", insertError);
      } else {
        response = "";
        goto(`/voting?gameId=${currentGameId}`);
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

  onMount(async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const gameIdParam = urlParams.get("gameId");
    if (!gameIdParam) {
      alert("No game ID provided. Redirecting to waiting room.");
      goto("/waitingroom");
      return;
    }
    currentGameId = Number(gameIdParam);

    currentGame = await fetchGame();
    if (currentGame && currentGame.prompt_id) {
      prompt = await fetchPrompt(currentGame.prompt_id);
    }

    setupPlayerCountMonitoring();

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
    if (unsubscribe) {
      if (typeof unsubscribe.unsubscribe === "function") {
        unsubscribe.unsubscribe();
      } else if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    }
  });
</script>

<div class="game-container">
  <img src="backgrounds/bgstart.png" alt="Background" class="backgroundbox" />
  <div class="prompt-wrapper">
    {#if errorMessage}
      <p class="error">{errorMessage}</p>
    {/if}
    {#if successMessage}
      <p class="success">{successMessage}</p>
    {/if}
    {#if prompt}
      <div class="prompt-container">
        <p>Prompt: {prompt.text}</p>
        <textarea bind:value={response} placeholder="Type your response here..."
        ></textarea>
        <button on:click={submitResponse}>Submit Response</button>
      </div>
    {:else}
      <p>Loading prompt...</p>
    {/if}
  </div>
  <div class="players">
    {#each playerimages.slice(0, playerCount) as playerimage}
      <img src={playerimage} alt="Player" class="player" />
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
