<script>
  import { goto } from "$app/navigation";
  import { supabase } from "$lib/supabaseClient";
  import { onMount } from "svelte";
  import { monitorPlayerCount } from '$lib/api';
  import {  tick } from 'svelte';

  let prompt = null; // The current prompt
  let response = ""; // The user's response
  let currentGameId = null; // The current game ID
  let unsubscribe;
  let currentGame;
  let playerCount = 0;
  let playerimages=["gameCharacters/PlayerRedIdle.png","gameCharacters/PlayerOrangeIdle.png","gameCharacters/PlayerYellowIdle.png","gameCharacters/PlayerLightGreenIdle.png","gameCharacters/PlayerDarkGreenIdle.png","gameCharacters/PlayerBlueIdle.png","gameCharacters/PlayerPurpleIdle.png","gameCharacters/PlayerPinkIdle.png"]



  // Fetch the most recent game
  async function fetchLatestGame() {
      const { data: latestGame, error } = await supabase
          .from('game')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

      if (error) {
          console.error('Error fetching the latest game:', error);
          throw error;
      }

      return latestGame;
  }

  // Monitor player count for the latest game
  async function setupPlayerCountMonitoring() {
      try {
          currentGame = await fetchLatestGame();
          console.log('Current game:', currentGame);

          // Fetch the initial player count
          const { data: players, error } = await supabase
              .from('profiles')
              .select('*')
              .eq('game_id', currentGame.id);

          if (error) {
              console.error('Error fetching initial players:', error);
              return;
          }

          playerCount = players.length; // Update playerCount dynamically
          console.log(`Initial players in game ${currentGame.id}:`, playerCount);

          // Subscribe to changes in player count
          unsubscribe = monitorPlayerCount(currentGame.id, () => {
              // Redirect to the active game page when ready
              goto('/game');
          // @ts-ignore
          }, (newCount) => {
              // Update playerCount when a new player joins
              playerCount = newCount;
          });
      } catch (error) {
          console.error('Error setting up player count monitoring:', error);
      }
  }
   
  onMount(() => {
      setupPlayerCountMonitoring();

      return () => {
          // @ts-ignore
          if (unsubscribe) unsubscribe();
      };
  });

  onMount(async () => {
    try {
      // Fetch the latest game to get the current game ID and prompt ID
      const { data: latestGame, error: gameError } = await supabase
        .from("game")
        .select("id, prompt_id")
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (gameError) {
        console.error("Error fetching the latest game:", gameError);
        goto("/waitingroom"); // Redirect if no game is found
        return;
      }

      currentGameId = latestGame.id;

      // Fetch the prompt for the current game
      const { data: fetchedPrompt, error: promptError } = await supabase
        .from("prompts")
        .select("*")
        .eq("id", latestGame.prompt_id)
        .single();

      if (promptError || !fetchedPrompt) {
        console.error("Error fetching prompt:", promptError);
        goto("/waitingroom"); // Redirect if no prompt is found
        return;
      }

      prompt = fetchedPrompt;
    } catch (error) {
      console.error("Error loading prompt:", error);
      goto("/waitingroom"); // Redirect on any unexpected error
    }
  });

  async function submitResponse() {
    try {
      // Get the current user
      const { data: user, error: userError } = await supabase.auth.getUser();
      if (userError || !user) {
        console.error("No user is signed in:", userError);
        return;
      }

      const userId = user.user.id;

      // Insert the response into the responses table
      const { error: insertError } = await supabase.from("responses").insert([
        {
          // @ts-ignore
          game_id: currentGameId,
          player_id: userId,
          text: response,
        },
      ]);

      if (insertError) {
        console.error("Error submitting response:", insertError);
      } else {
        response = ""; // Clear the input field
        goto("/voting"); // Redirect to the voting page
      }
    } catch (error) {
      console.error("Error in submitResponse:", error);
    }
  }

  async function submitResponsefordrawing(img) {
    try {
      // Get the current user
      const { data: user, error: userError } = await supabase.auth.getUser();
      if (userError || !user) {
        console.error("No user is signed in:", userError);
        return;
      }

      const userId = user.user.id;

      // Insert the response into the responses table
      const { error: insertError } = await supabase.from("responses").insert([
        {
          // @ts-ignore
          game_id: currentGameId,
          player_id: userId,
          drawing: img,
        },
      ]);

      if (insertError) {
        console.error("Error submitting response:", insertError);
      } else {
        response = ""; // Clear the input field
        goto("/voting"); // Redirect to the voting page
      }
    } catch (error) {
      console.error("Error in submitResponse:", error);
    }
  }

//drawing prompt
let canvas;
let ctx;
let isDrawing = false;
let color = '#000000';
let lineWidth = 5;

onMount(async () => {
  await tick(); // Wait for DOM updates

  let tries = 10; // Retry a few times
  while (!canvas && tries > 0) {
    console.log("Waiting for canvas...");
    await new Promise(r => setTimeout(r, 100)); // Wait 100ms
    tries--;
  }

  if (!canvas) {
    console.error("Canvas still not available!");
    return;
  }

  ctx = canvas.getContext("2d");
  ctx.fillStyle = "white"; 
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  console.log("Canvas initialized successfully:", ctx);
});



function startDrawing(event) {
  if (!ctx) return;
  isDrawing = true;
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.moveTo(event.offsetX, event.offsetY);
}

function draw(event) {
  if (!isDrawing || !ctx) return;
  ctx.lineTo(event.offsetX, event.offsetY);
  ctx.stroke();
}

function stopDrawing() {
  isDrawing = false;
}

function clearCanvas() {
  if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function submitDrawing() {
  if (!ctx) return;

  // Convert canvas to base64 image
  const canvasImage = canvas.toDataURL("image/png"); // PNG format

  // Now, you can save the `canvasImage` to the database
  submitResponsefordrawing(canvasImage);
  console.log("Drawing saved to database:", canvasImage);
}

</script>

<div class="game-container">
  <img src="backgrounds/bgstart.png" alt="Background" class="backgroundbox" >
  <div class="prompt-wrapper">
    {#if prompt}
      <div class="prompt-container">
        <p>Prompt: {prompt.text}</p>
        <div class="box"><textarea bind:value={response} placeholder="Type your response here..."></textarea></div>
        <div class="box">
          <button on:click={submitResponse}>Submit</button>
        </div>  
      </div>
    {:else}
      <p>Loading prompt...</p>
    {/if}
  </div>  
  <div class="players">
    {#each playerimages.slice(0,playerCount) as playerimage}
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
    min-height: 100vh; /* Full height */
    background-color: #078fd8; /* Blue background */
  }

  .backgroundbox {
    width: 80%;
    height: 60%;
    background-size: cover;
    background-position: center;
    border-radius: 12px;
    margin-top: 10px;
    animation: bgAnimation 1s infinite ;
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
    width: 80%;
    max-width: 900px;
    position: absolute;
    top: 35%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 60%;
    max-width: 500px;
    /*padding: 20px;
    border-radius: 12px;
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);*/
  }

  .prompt-container {
    font-size: 1em;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 15px;
    top: 45vh;
    flex-direction: column;
  }

  textarea {
    display: flex;
    width: 95%;
    height: 50px;
    margin: 10px 0;
    padding: 10px;
    border: 1px solid #ddd;
    border-radius: 8px;
    resize: none;
  }


  button {
    display: flex;
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

    width: 100vw;
    display: flex;
    justify-content: center;
    align-items: center;
    flex-wrap: wrap;
    padding: 0vh 0;
    position: fixed;
    bottom: 0;
    left: 0;
  }

  .player {
    display: flex;
    width: 12vw;
    height: 12vw;
    max-width: 150px;
    max-height: 150px;
    margin: 0vw;
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
  button {
    padding: 5px 10px;
    background: red;
    color: white;
    border: none;
    cursor: pointer;
  }



/* <canvas
            bind:this={canvas}
            width="420"
            height="200"
            on:mousedown={startDrawing}
            on:mousemove={draw}
            on:mouseup={stopDrawing}
            on:mouseleave={stopDrawing}></canvas>
                      <div class="controls">
            <label>Color: <input type="color" bind:value={color} /></label>
            <label>Size: 
              <input type="range" min="1" max="20" step="1" bind:value={lineWidth} />
              {lineWidth}px
            </label>
          </div>
          <button on:click={clearCanvas}>Clear</button> */

</style>