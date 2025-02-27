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

// New function that requires explicit game ID
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
    .select('id, text, votes:votes(count)')
    .eq('game_id', gameId);

  if (error) {
    console.error('Error fetching responses:', error);
    return [];
  }
  
  return data.map((r) => ({
    id: r.id,
    response: r.text,
    vote_count: r.votes ? r.votes[0].count : 0,
  }));
}

export async function voteForResponse(responseId, userId, gameId) {
  console.log('Vote for response called');
  const { error } = await supabase
    .from('votes')
    .insert([{ response_id: responseId, user_id: userId, game_id: gameId }]);

  if (error) {
    console.error('Error casting vote:', error);
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

  console.log(`User ${userId} voted for response ${responseId}`);
  const allVoted = await checkAllVoted(gameId);
  return { allVoted };
}

export async function checkAllVoted(gameId) {
  const { data: players, error: countError } = await supabase
    .from('profiles')
    .select('voted')
    .eq('game_id', gameId);

  if (countError) {
    console.error('Error counting the votes', countError);
    return { error: 'Error counting votes' };
  }

  const allVoted = players.every(player => player.voted);
  console.log('All voted?', allVoted);
  return allVoted;
}

export async function calculateGameScores(gameId) {
  const { data: votes, error: votesError } = await supabase
    .from('votes')
    .select('response_id')
    .eq('game_id', gameId);
  if (votesError) throw votesError;

  const voteCounts = {};
  votes.forEach(vote => {
    voteCounts[vote.response_id] = (voteCounts[vote.response_id] || 0) + 1;
  });

  const { data: responses, error: responsesError } = await supabase
    .from('responses')
    .select('id, player_id')
    .eq('game_id', gameId);
  if (responsesError) throw responsesError;

  const playerVotes = {};
  responses.forEach((r) => {
    const count = voteCounts[r.id] || 0;
    if (!playerVotes[r.player_id]) {
      playerVotes[r.player_id] = { totalVotes: 0, responses: [] };
    }
    playerVotes[r.player_id].totalVotes += count;
    playerVotes[r.player_id].responses.push({ text: r.text, votes: count });
  });

  const playerIds = Object.keys(playerVotes);
  if (playerIds.length === 2) {
    const [p1, p2] = playerIds;
    const p1Votes = playerVotes[p1].totalVotes;
    const p2Votes = playerVotes[p2].totalVotes;

    if (p1Votes === p2Votes) {
      const p1Points = p1Votes * 100;
      const p2Points = p2Votes * 100;
      const p1Profile = await updatePlayerScore(p1, p1Points);
      const p2Profile = await updatePlayerScore(p2, p2Points);

      console.log(`Tie! Player ${p1} and Player ${p2} each got ${p1Points} points.`);
      return {
        tie: true,
        players: [
          { playerId: p1, username: p1Profile.username, votes: p1Votes, points: p1Points, responses: playerVotes[p1].responses },
          { playerId: p2, username: p2Profile.username, votes: p2Votes, points: p2Points, responses: playerVotes[p2].responses }
        ]
      };
    }
  }
  
  let winningPlayer = null;
  let maxVotes = 0;
  let runnerUpVotes = 0;
  responses.forEach(response => {
    const count = voteCounts[response.id] || 0;
    if (count > maxVotes) {
      runnerUpVotes = maxVotes;
      maxVotes = count;
      winningPlayer = response.player_id;
    } else if (count > runnerUpVotes) {
      runnerUpVotes = count;
    }
  });
  
  const difference = maxVotes - runnerUpVotes;
  const points = difference * 100;
  
  if (winningPlayer && points > 0) {
    const updatedProfile = await updatePlayerScore(winningPlayer, points);
    console.log(`Score updated for player ${winningPlayer}: +${points} points`);
    return {
      tie: false,
      winningPlayer,
      points,
      username: updatedProfile.username,
      maxVotes
    };
  }
  
  console.log('No score update necessary.');
  return { tie: false, winningPlayer: null, points: 0, maxVotes: 0 };
}

async function updatePlayerScore(playerId, pointsToAdd) {
  const { data: profileData, error: profileError } = await supabase
    .from('profiles')
    .select('score, username')
    .eq('id', playerId)
    .single();

  if (profileError) throw profileError;

  const currentScore = profileData.score || 0;
  const newScore = currentScore + pointsToAdd;

  const { error: updateError } = await supabase
    .from('profiles')
    .update({ score: newScore })
    .eq('id', playerId);

  if (updateError) throw updateError;

  return { ...profileData, score: newScore };
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