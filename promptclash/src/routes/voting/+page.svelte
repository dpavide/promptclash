<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { supabase } from "$lib/supabaseClient";
  import {
    fetchResponsesForGame,
    voteForResponse,
    checkAllVotedForPrompt,
  } from "$lib/api";
  import { goto } from "$app/navigation";

  let userId = "";
  let gameId = 0;
  let promptIndex: number = 0;
  let currentPrompt: any = null;
  let cleanup;

  let responses: Array<{
    id: number;
    text: string;
    player_id: string;
    vote_count: number;
  }> = [];

  let errorMessage = "";
  let responderIDs = new Set<string>();
  let playersWhoCanVote = 0;
  let playersCount = 0;  

  let hasVoted = false;
  let votesSubscription: any = null;
  let gameSubscription: any = null;
  
  //not needed right now
  let groups: Record<number, { prompt_text: string; responses: any[] }> = {};

  async function fetchPlayerCount() {
    const { data, error } = await supabase
      .from("profiles")
      .select("id")
      .eq("game_id", gameId);
    if (error || !data) {
      console.error("Error fetching players count:", error);
      return;
    }
    playersCount = data.length;
    playersWhoCanVote = playersCount - 2;
  }

  // Fetch the list of prompts and set the current prompt
  async function fetchCurrentPrompt() {
    const { data: promptsList, error } = await supabase
      .from("prompts")
      .select("id, text, player_id")
      .eq("game_id", gameId)
      .order("id", { ascending: true });

    if (error || !promptsList || promptsList.length === 0) {
      errorMessage = "No prompts found for this game.";
      return false;
    }
    if (promptIndex >= promptsList.length) {
      // done => final scoreboard
      goto(`/winner?gameId=${gameId}&final=true`);
      return false;
    }
    currentPrompt = promptsList[promptIndex];
    console.log("This is the current prompt", currentPrompt.id)
    return true;
  }

  /* function setupRealtimeSubscriptions() {
    // Votes table => update local vote counts => check if all voted => goto
    votesSubscription = supabase
      .channel("prompt-votes")
      .on(
        "postgres_changes",
        {
          event: '*',
          schema: 'public',
          table: 'votes',
          filter: `game_id=eq.${gameId}`
        }, 
        async () => {
          // re-fetch local vote counts
          console.log("print ihdajshdah")
          // check if all voted => goto winner
          const allVoted = await checkAllVotedForPrompt(gameId, currentPrompt?.id, playersWhoCanVote);
          if (allVoted) {
            goto(`/winner?gameId=${gameId}&promptIndex=${promptIndex}`);
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: '*',
          schema: 'public',
          table: 'responses',
          filter: `game_id=eq.${gameId} and response_id=eq.${currentPrompt.id}`
        },
        async () => {
          // re-fetch local vote counts
          await refreshVoteCounts();
          // check if all voted => goto winner
          const allVoted = await checkAllVotedForPrompt(gameId, currentPrompt.id, playersWhoCanVote);
          if (allVoted) {
            goto(`/winner?gameId=${gameId}&promptIndex=${promptIndex}`);
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "profiles",
          filter: `id=eq.${gameId}`
        }, 
        async () => {
          console.log("Checking the voting status asad")
          const allVoted = await checkAllVotedForPrompt(gameId, currentPrompt.id, playersWhoCanVote);
          if (allVoted) {
            goto(`/winner?gameId=${gameId}&promptIndex=${promptIndex}`);
          }
        }
      )
      .subscribe();

      return () => {
        if (votesSubscription) {
          supabase.removeChannel(votesSubscription);
        }
      }
  } */

  function setupRealtimeSubscriptions() {
        // Subscribe to votes table changes for this game
        votesSubscription = supabase
            .channel('game-votes')
            .on('postgres_changes', {
                event: '*', // Listen for all changes
                schema: 'public',
                table: 'profiles',
                filter: `game_id=eq.${gameId}`
            }, async () => {
                // Refresh responses when any vote changes
                const allVoted = await checkAllVotedForPrompt(gameId, currentPrompt.id, playersWhoCanVote);
                if (allVoted) {
                  goto(`/winner?gameId=${gameId}&promptIndex=${promptIndex}`);
                }
            })
            .subscribe();

        // Return cleanup function
        return () => {
            if (votesSubscription) {
                supabase.removeChannel(votesSubscription);
            }
        };
    }



  // Combined 2 functions: Fetch the responses for the current prompt
  async function fetchCurrentResponses() {
    if (!currentPrompt) return;
    const { data: responsesData, error: responsesError } = await supabase
      .from("responses")
      .select("id, text, player_id")
      .eq("game_id", gameId)
      .eq("prompt_id", currentPrompt.id);

    if (responsesError || !responsesData || responsesData.length < 2) {
      errorMessage = "Not enough responses for this prompt.";
      console.error(responsesError);
      return;
    }

    // Identify the 2 responders
    responderIDs = new Set(responsesData.map((r) => r.player_id));
    responses = responsesData.map((r) => ({
      id: r.id,
      text: r.text?.trim() || "{no response given}",
      player_id: r.player_id,
      vote_count: 0
    }));

    await refreshVoteCounts();
  }

  async function refreshVoteCounts() {
    if (!currentPrompt) return;
    const { data: allVotes, error } = await supabase
      .from("votes")
      .select("response_id")
      .eq("game_id", gameId)
      .eq("prompt_id", currentPrompt.id);

    if (error || !allVotes) {
      console.error("Error fetching votes for prompt:", error);
      return;
    }
    const counts: Record<number, number> = {};
    for (const v of allVotes) {
      counts[v.response_id] = (counts[v.response_id] || 0) + 1;
    }

    responses = responses.map((r) => ({
      ...r,
      vote_count: counts[r.id] || 0,
    }));
  }

  async function handleVote(responseId: number, responsePlayerId: string) {
    if (responderIDs.has(userId)) {
      alert("You can't vote for your own response!");
      return;
    }
    if (responsePlayerId === userId) {
      alert("You cannot vote on your own response. Stop trying bruh 💀");
      return;
    }
    if (hasVoted) {
      alert("You have already voted!");
      return;
    }
    try {
      const voteResult = await voteForResponse(responseId, userId, gameId, currentPrompt.id);
      if (voteResult?.error) {
        errorMessage = "Failed to submit vote.";
        return;
      }
      hasVoted = true;
      const allVoted = await checkAllVotedForPrompt(gameId, currentPrompt.id, playersWhoCanVote);
      if (allVoted) {
        goto(`/winner?gameId=${gameId}&promptIndex=${promptIndex}`);
      }
    } catch (error) {
      console.error("Error voting:", error);
      errorMessage = "Failed to submit vote.";
    }
  }

  onMount(async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const gameIdParameter = urlParams.get("gameId");
    const PromptIndexParameter = urlParams.get("promptIndex");
    if (!gameIdParameter) {
      alert("Game ID not specified.");
      goto("/waitingroom");
      return;
    }
    const {data: sessionData} = await supabase.auth.getSession();
    userId = sessionData?.session?.user?.id;
    const { data: latestGam, error: gameError } = await supabase
    .from("game")
      .select("id")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

     if (!gameError) {
        console.log("no game error");
        gameId = Number(gameIdParameter);
        promptIndex = PromptIndexParameter ? Number(PromptIndexParameter) : 0;
        await fetchPlayerCount();
        const ok = await fetchCurrentPrompt();
        if (!ok || !currentPrompt) return;
        await fetchCurrentResponses();
        const cleanup = setupRealtimeSubscriptions();
        
        onDestroy(cleanup);
  } else {
    console.error("Error fetching current game:", gameError);
  }
});

</script>


<h1>Voting on Prompt #{promptIndex + 1}</h1>

{#if currentPrompt}
  <p><strong>Prompt:</strong> {currentPrompt.text}</p>

  {#each responses as r (r.id)}
    <div style="margin-bottom: 1rem;">
      <p>{r.text}</p>
      <p>Votes: {r.vote_count}</p>

      {#if responderIDs.has(userId)}
        <p style="color: gray;">(You are a responder; no voting)</p>
      {:else if r.player_id === userId}
        <p style="color: gray;">(Your own response)</p>
      {:else if hasVoted}
        <p style="color: gray;">(You already voted!)</p>
      {:else}
        <button on:click={() => handleVote(r.id, r.player_id)}>Vote</button>
      {/if}
    </div>
  {/each}
{:else}
  <p>Loading prompt...</p>
{/if}

{#if errorMessage}
  <p style="color: red;">{errorMessage}</p>
{/if}
