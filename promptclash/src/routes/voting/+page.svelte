<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { supabase } from "$lib/supabaseClient";
  import {
    fetchResponsesForGame,
    fetchGamePrompts,
    voteForResponse,
    calculateGameScores,
    checkAllVotedForPrompt,
    calculatePromptScores,
  } from "$lib/api";
  import { goto } from "$app/navigation";

  
  let userId = "";
  let gameId= 0;

  let promptIndex: number = 0;
  let allPrompts: any[] = [];
  let currentPrompt: any = null;
  let responses: Array<{
    id: number;
    text: string;
    player_id: string;
    vote_count: number;
  }> = [];
  

  let hasVoted = false; 
  let subscription: any; 
  let VotesSubscription: any;
  let errorMessage = "";

  let playersWhoCanVote = 0;
  let playersCount = 0;
  let responderIDs = new Set<string>();

    //not needed right now
  let groups: Record<number, { prompt_text: string, responses: any[] }> = {};

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
    // For example, if the two responders don’t vote:
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
    return true;
  }

  // Combined 2 functions: Fetch the responses for the current prompt & Subscribe to the responses table.
  async function fetchCurrentResponsesAndSetupSubscription() {
    if(!currentPrompt){
      console.warn("No current prompt to fetch responses for.");
      return;
    }
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
    responderIDs = new Set(responsesData.map(r => r.player_id));
    responses = responsesData.map(r => ({
      id: r.id,
      text: r.text?.trim() || "{no response given}",
      player_id: r.player_id,
      vote_count: 0
    }));

    VotesSubscription = supabase
      .channel("prompt-votes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "votes",
          filter: `game_id=eq.${gameId} and prompt_id=eq.${currentPrompt.id}`
        },
        async () => {
          await refreshVoteCounts(); // function that refetches votes
           const allVoted = await checkAllVotedForPrompt(gameId, currentPrompt.id, playersWhoCanVote);
          if (allVoted) {
            goto(`/winner?gameId=${gameId}&promptIndex=${promptIndex}`);
          }
        }
      )
      .subscribe();

    // Immediately do a refresh of vote counts
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

    responses = responses.map(r => ({
      ...r,
      vote_count: counts[r.id] || 0
    }));
  }


    // Fetch the current prompt (based on promptIndex) and its 2 responses.
    async function fetchPromptAndResponses() {
    try {
      // Fetch all prompts for this game (sorted by id).
      const { data: promptList, error: pErr } = await supabase
        .from("prompts")
        .select("id, text, player_id")
        .eq("game_id", gameId)
        .order("id", { ascending: true });
      if (pErr || !promptList || promptList.length === 0) {
        errorMessage = "No prompts found for this game.";
        return false;
      }
      // If promptIndex exceeds list length, finish voting.
      if (promptIndex >= promptList.length) {
        goto(`/winner?gameId=${gameId}&final=true`);
        return false;
      }
      currentPrompt = promptList[promptIndex];

      // Fetch responses for this prompt.
      const { data: respList, error: rErr } = await supabase
        .from("responses")
        .select("id, text, player_id")
        .eq("game_id", gameId)
        .eq("prompt_id", currentPrompt.id);
      if (rErr || !respList || respList.length < 2) {
        errorMessage = "Not enough responses found for this prompt.";
        return false;
      }
      // Map responses: use r.text (or fallback to a default message if empty)
      responses = respList.map(r => ({
        id: r.id,
        text: r.text && r.text.trim().length > 0 ? r.text : "{no response given}",
        player_id: r.player_id,
        vote_count: 0 // vote counts will be updated by subscription.
      }));
      return true;
    } catch (err) {
      console.error("Error in fetchPromptAndResponses:", err);
      errorMessage = "Error loading prompt/responses.";
      return false;
    }
  }

  // Fetch responses, prompts, and vote counts, then group them.
  async function fetchResponsesWithPrompt() {
    // Fetch responses for this game
    const { data: responses, error: responsesError } = await supabase
      .from("responses")
      .select("id, text, prompt_id, player_id")
      .eq("game_id", gameId);
    if (responsesError || !responses) {
      errorMessage = "Failed to fetch responses.";
      return;
    }

    // Fetch prompts to get the prompt text
    const { data: prompts, error: promptsError } = await supabase
      .from("prompts")
      .select("id, text")
      .eq("game_id", gameId);
    if (promptsError || !prompts) {
      errorMessage = "Failed to fetch prompts.";
      return;
    }
    const promptMap: Record<number, string> = {};
    for (const p of prompts) {
      promptMap[p.id] = p.text;
    }

    // Fetch votes for the game
    const { data: votes, error: votesError } = await supabase
      .from("votes")
      .select("response_id")
      .eq("game_id", gameId);
    if (votesError || !votes) {
      errorMessage = "Failed to fetch votes.";
      return;
    }
    const voteCounts: Record<number, number> = {};
    for (const v of votes) {
      voteCounts[v.response_id] = (voteCounts[v.response_id] || 0) + 1;
    }

    // Group responses by prompt_id and attach vote counts.
    let tempGroups: Record<number, { prompt_text: string, responses: any[] }> = {};
    responses.forEach((r: any) => {
      const pid = r.prompt_id;
      // Use r.text (if empty, fallback to a default string)
      const text = r.text && r.text.trim().length > 0 ? r.text : "{no response given}";
      if (!tempGroups[pid]) {
        tempGroups[pid] = { prompt_text: promptMap[pid] || "Unknown prompt", responses: [] };
      }
      tempGroups[pid].responses.push({
        id: r.id,
        text,
        player_id: r.player_id,
        vote_count: voteCounts[r.id] || 0
      });
    });
    groups = tempGroups;
  }

  async function fetchResponses() {
    if (!gameId) return;
    const data = await fetchResponsesForGame(gameId);
    responses =
      data.map((r) => ({
        ...r,
        response:
          r.text?.trim().length > 0 ? r.text : "{no response given}",
      })) || [];
  }

  async function checkIfUserVoted() {
    if (!userId || !gameId) return;
    const { data, error } = await supabase
      .from("votes")
      .select("id")
      .eq("user_id", userId)
      .eq("game_id", gameId)
      .eq("prompt_id", currentPrompt.id)
      .maybeSingle();
      if (!error && data) {
        hasVoted = true;
    }
  }

  async function handleVote(responseId: number, responsePlayerId: string) {
    if (responderIDs.has(userId)) {
      alert("You can't vote for your own response!");
      return;
    }
    try {
      const voteResult = await voteForResponse(responseId, userId, gameId, currentPrompt.id);
      if (voteResult?.error) {
        errorMessage = "Failed to submit vote.";
        return;
      }
      // after voting, check if everyone who was allowed to vote did
      const allVoted = await checkAllVotedForPrompt(gameId, currentPrompt.id, playersWhoCanVote);
      if (allVoted) {
        goto(`/winner?gameId=${gameId}&promptIndex=${promptIndex}`);
      } else {
        errorMessage = "Waiting for others to vote...";
      }
    } catch (error) {
      console.error("Error voting:", error);
      errorMessage = "Failed to submit vote.";
    }
  }

  // Custom subscription function for votes
  function subscribeToVotesUpdates() {
    return supabase
      .channel("game-votes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "votes",
          // Only watch votes for this game & this prompt
          filter: `game_id=eq.${gameId} and prompt_id=eq.${currentPrompt?.id}`
        },
        async () => {
          // Re-check if everyone has voted
          const allVoted = await checkAllVotedForPrompt(
            gameId,
            currentPrompt?.id,
            playersWhoCanVote
          );
          if (allVoted) {
            // Proceed to winner page for this prompt
            goto(`/winner?gameId=${gameId}&promptIndex=${promptIndex}`);
          }
        }
      )
      .subscribe();
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
    gameId = Number(gameIdParameter);
    promptIndex = PromptIndexParameter? Number(PromptIndexParameter) : 0;

    // Get user info
    const { data: sessionData } = await supabase.auth.getSession();
    userId = sessionData?.session?.user?.id || "";

    await fetchPlayerCount();

    const ok = await fetchCurrentPrompt();
    if (!ok || !currentPrompt){
      return;
    }
    await fetchCurrentResponsesAndSetupSubscription();
  });

  onDestroy(() => {
    if (VotesSubscription && typeof VotesSubscription.unsubscribe === "function") {
      VotesSubscription.unsubscribe();
    }
  });
</script>

<div>
  <h1>Voting on Prompt #{promptIndex + 1}</h1>

  {#if currentPrompt}
    <p><strong>Prompt:</strong> {currentPrompt.text}</p>

    {#each responses as r (r.id)}
      <div style="margin-bottom: 1rem;">
        <p>{r.text}</p>
        <p>Votes: {r.vote_count}</p>

        {#if responderIDs.has(userId)}
          <!-- You are a responder => can't vote on ANY response -->
          <p style="color: gray;">(Responders cannot vote)</p>
        {:else}
          <!-- normal user => can vote, unless it's your own response (optional) -->
          {#if r.player_id === userId}
            <p style="color: gray;">(Your own response)</p>
          {:else}
            <button on:click={() => handleVote(r.id, r.player_id)}>Vote</button>
          {/if}
        {/if}
      </div>
    {/each}
  {:else}
    <p>Loading prompt...</p>
  {/if}

  {#if errorMessage}
    <p style="color: red;">{errorMessage}</p>
  {/if}
</div>