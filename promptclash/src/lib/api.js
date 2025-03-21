import { supabase } from '$lib/supabaseClient';

export async function initializeDatabase() {
  console.log('Initializing database for a new game');

  // Insert an empty game record
  const { data, error } = await supabase.from('game').insert([{}]).select();

  if (error) {
    console.error('Error initializing database:', error);
    return;
  } else {
    // Assign a prompt to the new game
    await assignPromptToGame(data[0].id);
    console.log('New game added successfully:', data[0].id);
  }
  return data;
}

export async function checkProfanity(text) {
  try {
    const res = await fetch(
      `https://api.api-ninjas.com/v1/profanityfilter?text=${encodeURIComponent(text)}`,
      {
        headers: {
          "X-Api-Key": "YegnxWw3X0xgvCkPMEaUCg==ugPzwG3b5VAktHVf"
        }
      }
    );
    if (!res.ok) {
      throw new Error(`API Error: ${res.status} ${await res.text()}`);
    }
    const result = await res.json();
    // 'result.censored' is assumed to be the entire text with asterisks where profanity was found
    return result.censored;
  } catch (error) {
    console.error("Error checking profanity:", error);
    // Fallback: if the API call fails, just return the original text
    return text;
  }
}

// Function that requires explicit game ID
export async function addUserToGame(username, authData, gameId) {
  if (!username) {
    throw new Error('Username is required');
  }
  if (!authData) {
    throw new Error('No auth data for some reason');
  }
  if (!gameId) {
    throw new Error('Game ID is required');
  }

  const { error: profileError } = await supabase.from('profiles').insert([
    { id: authData.id, username: username, game_id: gameId }
  ]);

  if (profileError) {
    console.error('Error adding profile:', profileError);
    throw profileError;
  }

  console.log(`User ${username} added to game ${gameId}`);
}

export async function submitPlayerPrompt(gameId, userId, promptText) {
  let finalPromptText = promptText.trim();

  // If user left prompt blank => pick a random from the existing default prompts
  if (!finalPromptText) {
    // fetch all default prompts
    const { data: defaultPrompts, error: defError } = await supabase
      .from('prompts')
      .select('text')
      .eq('is_default', true);

    if (defError || !defaultPrompts || defaultPrompts.length === 0) {
      throw new Error('No default prompts available');
    }

    // pick a random one
    const randomIndex = Math.floor(Math.random() * defaultPrompts.length);
    finalPromptText = defaultPrompts[randomIndex].text;
  }

  //Insert as a new row with is_default = false
  const { error } = await supabase
    .from('prompts')
    .insert([{ text: finalPromptText, game_id: gameId, player_id: userId, is_default: false }]);

  if (error) {
    console.error('Error submitting prompt:', error);
    throw error;
  }
  console.log(`User ${userId} wrote a prompt: ${finalPromptText}`);
}

// Fetch all prompts for a given game
export async function fetchGamePrompts(gameId) {
  const { data, error } = await supabase
    .from('prompts')
    .select('id, text, player_id')
    .eq('game_id', gameId);
  if (error) {
    console.error('Error fetching prompts:', error);
    return [];
  }
  return data;
}

// Insert a new row in 'responses' for each prompt the user is answering.
// The 'text' field is the user's response, 'prompt_id' is the ID of the prompt being answered.
export async function submitResponse(gameId, userId, promptId, responseText) {
  const { error } = await supabase
    .from('responses')
    .insert([
      {
        game_id: gameId,
        player_id: userId,
        prompt_id: promptId,
        text: responseText
      }
    ]);
  if (error) {
    console.error('Error submitting response:', error);
    throw error;
  }
  console.log(`User ${userId} responded to prompt ${promptId}: ${responseText}`);
}

// Kept for backward compatibility, but not recommended for new code
export async function addUserToLatestGame(username, authData) {
  if (!username) {
    throw new Error('Username is required');
  }
  if (!authData) {
    throw new Error('No auth data for some reason');
  }

  const gameId = await getLatestGameId();
  if (!gameId) {
    throw new Error('No game found. Please create a game first.');
  }

  return addUserToGame(username, authData, gameId);
}

// New function that safely gets the latest game ID without creating one
export async function getLatestGameId() {
  const { data, error } = await supabase
    .from('game')
    .select('id')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      // No game found - instead of creating one, return null
      return null;
    }
    console.error('Error fetching the latest game:', error);
    throw error;
  }

  return data.id;
}

export async function monitorPlayerCount(gameId, onReady, onPlayerCountChange) {
  const { data: players, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('game_id', gameId);

  if (error) {
    console.error('Error fetching players:', error);
    return;
  }

  const initialCount = players.length;
  console.log(`Initial players in game ${gameId}:`, initialCount);

  if (onPlayerCountChange) onPlayerCountChange(initialCount);
  if (initialCount >= 2) {
    onReady();
    return;
  }

  const subscription = supabase
    .channel('player-count')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'profiles', filter: `game_id=eq.${gameId}` },
      (payload) => {
        console.log('New player joined:', payload.new);
        const newCount = initialCount + 1;
        if (onPlayerCountChange) onPlayerCountChange(newCount);
        if (newCount >= 2) {
          onReady();
        }
      }
    )
    .subscribe();

    return () => {
    supabase.removeChannel(subscription);
  };
}

export async function fetchPrompt() {
  const { data: prompts, error } = await supabase.from('prompts').select('*');

  if (error) {
    console.error('Error fetching prompts:', error);
    throw error;
  }

  if (!prompts || prompts.length === 0) {
    throw new Error('No prompts found');
  }

  const randomIndex = Math.floor(Math.random() * prompts.length);
  return prompts[randomIndex];
}

export async function assignPromptToGame(gameId) {
  const prompt = await fetchPrompt();
  const { error: updateError } = await supabase
    .from('game')
    .update({ prompt_id: prompt.id })
    .eq('id', gameId);

  if (updateError) {
    console.error('Error updating game with prompt:', updateError);
    throw updateError;
  }

  console.log(`Prompt ID ${prompt.id} assigned to game ${gameId}`);
}

// Modified to use the explicit game ID instead of assuming latest
export async function fetchPromptForGame(gameId) {
  if (!gameId) {
    throw new Error('Game ID is required');
  }

  const { data: game, error: gameError } = await supabase
    .from('game')
    .select('prompt_id')
    .eq('id', gameId)
    .single();

  if (gameError) {
    console.error(`Error fetching game ${gameId}:`, gameError);
    throw gameError;
  }

  if (!game.prompt_id) {
    throw new Error(`No prompt assigned to game ${gameId}`);
  }

  const { data: prompt, error: promptError } = await supabase
    .from('prompts')
    .select('*')
    .eq('id', game.prompt_id)
    .single();

  if (promptError) {
    console.error('Error fetching prompt for game:', promptError);
    throw promptError;
  }

  return prompt;
}

// Kept for backward compatibility
export async function fetchPromptForCurrentGame() {
  const gameId = await getLatestGameId();
  if (!gameId) {
    throw new Error('No active game found');
  }
  return fetchPromptForGame(gameId);
}

export async function fetchResponsesForGame(gameId) {
  const { data, error } = await supabase
    .from('responses')
    .select('id, text, game_id, player_id, prompt_id')
    .eq('game_id', gameId);

  if (error) {
    console.error('Error fetching responses:', error);
    return [];
  }
  return data;
  // return data.map((r) => ({
  //   id: r.id,
  //   response: r.text,
  //   vote_count: r.votes ? r.votes[0].count : 0,
  // }));
}

export async function voteForResponse(responseId, userId, gameId, promptId) {
  console.log('Vote for response called');
  const { error: insertErr } = await supabase
    .from('votes')
    .insert([{ 
      response_id: responseId, 
      user_id: userId, 
      game_id: gameId, 
      prompt_id: promptId 
    }]);

  if (insertErr) {
    console.error('Error casting vote:', insertErr  );
    return { error: 'Error submitting vote' };
  }

  const { updateError } = await supabase
    .from('profiles')
    .update({ voted: true })
    .eq('id', userId);

  if (updateError) {
    console.error('Error updating voting status of player', updateError);
    return { error: 'Error updating voting status' };
  }

  console.log(`User ${userId} voted for response ${responseId} (prompt_id=${promptId})`);
  return { success: true };
  // const allVoted = await checkAllVoted(gameId);
  // return { allVoted };
}

// export async function checkAllVoted(gameId) {
//   const { data: players, error: countError } = await supabase
//     .from('profiles')
//     .select('*')
//     .eq('game_id', gameId);

//   if (countError) {
//     console.error('Error counting the votes', countError);
//     return { error: 'Error counting votes' };
//   }

//   const allVoted = players.every((player) => player.voted);
//   console.log('All voted?', allVoted);
//   return allVoted;
// }

export async function checkAllVotedForPrompt(gameId, promptId, neededVoters) {
  const { data: votes, error: votesErr } = await supabase
    .from('votes')
    .select('user_id')
    .eq('game_id', gameId)
    .eq('prompt_id', promptId);

  console.log("This is the vote data", votes)

  if (votesErr || !votes) {
    console.error("Error fetching votes for prompt", promptId, votesErr);
    return false;
  }

  const uniqueVoters = new Set(votes.map(v => v.user_id));
  console.log(`Prompt #${promptId} => uniqueVoters=${uniqueVoters.size}, needed=${neededVoters}`);
  return (uniqueVoters.size >= neededVoters);
}


// Helper to fetch all votes for a game
export async function fetchVotesForGame(gameId) {
  const { data, error } = await supabase
    .from('votes')
    .select('response_id, user_id, game_id')
    .eq('game_id', gameId);
  if (error) {
    console.error('Error fetching votes for game:', error);
    return [];
  }
  return data;
}

export async function calculatePromptScores(gameId, promptId) {
  // 1) fetch the 2 responses for that prompt
  const { data: responses, error: respErr } = await supabase
    .from('responses')
    .select('id, player_id')
    .eq('game_id', gameId)
    .eq('prompt_id', promptId);

  if (respErr || !responses || responses.length < 2) {
    console.error("Not enough responses for prompt:", promptId);
    return { error: "Not enough responses" };
  }

  // 2) fetch votes for these responses
  const responseIds = responses.map(r => r.id);
  const { data: votes, error: voteErr } = await supabase
    .from('votes')
    .select('response_id')
    .in('response_id', responseIds)
    .eq('game_id', gameId);

  if (voteErr || !votes) {
    console.error("Error fetching votes for prompt:", promptId, voteErr);
    return { error: "Error fetching votes" };
  }

  // 3) tally votes
  const voteCounts = {};
  for (const v of votes) {
    voteCounts[v.response_id] = (voteCounts[v.response_id] || 0) + 1;
  }

  // 4) figure out winner/loser
  let [respA, respB] = responses;
  const countA = voteCounts[respA.id] || 0;
  const countB = voteCounts[respB.id] || 0;

  let winningResp = { ...respA, vote_count: countA };
  let losingResp = { ...respB, vote_count: countB };

  if (countB > countA) {
    winningResp = { ...respB, vote_count: countB };
    losingResp = { ...respA, vote_count: countA };
  } else if (countA === countB) {
    // tie scenario
    return { 
      tie: true, 
      respA: { ...respA, vote_count: countA }, 
      respB: { ...respB, vote_count: countB },
      pointsA: countA * 100,
      pointsB: countB * 100
    };
  }

  // 5) awarding points
  const basePointsA = countA * 100;
  const basePointsB = countB * 100;
  const bonusPoints = 50;

  // Update scores
  await updatePlayerScore(winningResp.player_id, basePointsA + bonusPoints);
  await updatePlayerScore(losingResp.player_id, basePointsB);

  return {
    tie: false,
    winner: { ...winningResp, points: basePointsA + bonusPoints },
    loser: { ...losingResp, points: basePointsB },
    bonusPoints: bonusPoints
  };
}

export async function calculateGameScores(gameId) {
  const { data: votes, error: votesError } = await supabase
    .from('votes')
    .select('response_id')
    .eq('game_id', gameId);
  if (votesError) throw votesError;

  const voteCounts = {};
  votes.forEach((vote) => {
    voteCounts[vote.response_id] = (voteCounts[vote.response_id] || 0) + 1;
  });

  const { data: responses, error: responsesError } = await supabase
    .from('responses')
    .select('id, player_id, text')
    .eq('game_id', gameId);
  if (responsesError) throw responsesError;

  const playerVotes = {};
  for (const r of responses){
    const count = voteCounts[r.id] || 0;
    if (!playerVotes[r.player_id]) {
      playerVotes[r.player_id] = { totalVotes: 0, responses: [] };
    }
    playerVotes[r.player_id].totalVotes += count;
    playerVotes[r.player_id].responses.push({ text: r.text, votes: count });
  }

  const playerIds = Object.keys(playerVotes);
  if (playerIds.length === 0) {
    console.log('No votes to calculate');
    return { tie: false, winningPlayer: null, points: 0, maxVotes: 0 };
  }

  let maxTotalVotes = 0;
  for (const pid of playerIds) {
    if (playerVotes[pid].totalVotes > maxTotalVotes) {
      maxTotalVotes = playerVotes[pid].totalVotes;
    }
  }

  // Check how many players share that max total
  const topPlayers = playerIds.filter(
    (pid) => playerVotes[pid].totalVotes === maxTotalVotes
  );

  if (topPlayers.length > 1) {
    // === TIE SCENARIO (multiple players share the top vote count) ===
    const results = [];
    for (const pid of playerIds) {
      // You can choose whether all players get points or only top players
      // Here, each player's totalVotes => points
      const pointsToAdd = playerVotes[pid].totalVotes * 100;
      const profile = await updatePlayerScore(pid, pointsToAdd);
      results.push({
        playerId: pid,
        username: profile.username,
        votes: playerVotes[pid].totalVotes,
        points: pointsToAdd,
        responses: playerVotes[pid].responses
      });
    }
    console.log("Tie among players:", topPlayers);
    return {
      tie: true,
      players: results
    };
  } else {
    // === SINGLE WINNER SCENARIO ===
    const winningPlayer = topPlayers[0];
    // Find the second-highest total
    let runnerUpVotes = 0;
    for (const pid of playerIds) {
      if (pid !== winningPlayer) {
        const v = playerVotes[pid].totalVotes;
        if (v > runnerUpVotes) runnerUpVotes = v;
      }
    }

    const difference = maxTotalVotes - runnerUpVotes;
    const bonusPoints = difference * 100;

    if (bonusPoints > 0) {
      const updatedProfile = await updatePlayerScore(winningPlayer, bonusPoints);
      console.log(
        `Score updated for player ${winningPlayer}: +${bonusPoints} points`
      );
      return {
        tie: false,
        winningPlayer,
        points: bonusPoints,
        username: updatedProfile.username,
        maxVotes: maxTotalVotes
      };
    } else {
      // No difference => no bonus
      console.log("No difference in votes, no bonus awarded.");
      return { tie: false, winningPlayer, points: 0, maxVotes: maxTotalVotes };
    }
  }
}


async function updatePlayerScore(playerId, pointsToAdd) {
  const { data: profileData, error: profileError } = await supabase
    .from('profiles')
    .select('score, username')
    .eq('id', playerId)
    .single();

  if (profileError) 
    {
      console.error('Error fetching profile to update score:', profileError);
      throw profileError;
    }

  const currentScore = profileData.score || 0;
  const newScore = currentScore + pointsToAdd;

  const { error: updateError } = await supabase
    .from('profiles')
    .update({ score: newScore })
    .eq('id', playerId);

  if (updateError) throw updateError;

  console.log(`Player ${playerId} score updated from ${currentScore} to ${newScore}`);
  return { ...profileData, score: newScore };
}

export async function fetchAllPlayersScores(gameId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, score')
    .eq('game_id', gameId)
    .order('score', { ascending: false });

  if (error) {
    console.error("Error fetching final scores:", error);
    return [];
  }
  return data;
} 

export function subscribeToVotes(gameId, onUpdate) {
  const channel = supabase.channel("game-changes");

  channel.on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'votes', filter: `game_id=eq.${gameId}` },
    async () => {
      console.log('Votes updated, refreshing responses');
      const updatedResponses = await fetchResponsesForGame(gameId);
      onUpdate(updatedResponses);
    }
  );

  channel.on(
    "postgres_changes",
    { event: "*", schema: "public", table: "responses", filter: `game_id=eq.${gameId}` },
    async () => {
      console.log("Responses updated, refreshing responses");
      const updatedResponses = await fetchResponsesForGame(gameId);
      onUpdate(updatedResponses);
    }
  );

  channel.subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

// Modified to never auto-create a game
export async function fetchCurrentGameId() {
  return getLatestGameId();
}

export async function fetchWinningResponse(gameId) {
  let responses = [];
  const { data, error } = await supabase
    .from("responses")
    .select(`
      id,
      text,
      player_id,
      game_id,
      votes:votes(count)
    `)
    .eq("game_id", gameId);
  if (error) {
    console.error("Error fetching responses:", error);
    return null;
  } 

  responses = data.map((response) => ({
    id: response.id,
    response: response.text,
    vote_count: response.votes ? response.votes[0].count : 0,
    player_id: response.player_id
  }));
  
  console.log("Responses are:", responses);

  if (responses.length === 0) {
    return null;
  }

  if (responses.length > 0) {
    let winningResponse = responses.reduce(
      (max, response) => response.vote_count > max.vote_count ? response : max, 
      responses[0]
    );
    let losingResponse = responses.find(r => r.id !== winningResponse.id) || { vote_count: 0 };

    const { data: winnerProfile } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", winningResponse.player_id)
      .single();
    
    const { data: loserProfile } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", losingResponse.player_id)
      .single();

    winningResponse.username = winnerProfile?.username || "Unknown";
    winningResponse.pointsEarned = (winningResponse.vote_count - losingResponse.vote_count) * 100 + 
      (winningResponse.vote_count > losingResponse.vote_count ? 50 : 0);

    losingResponse.username = loserProfile?.username || "Unknown";
    losingResponse.pointsEarned = losingResponse.vote_count * 100;

    return { winningResponse, losingResponse };
  }

  return null;
}