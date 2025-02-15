import { supabase } from '$lib/supabaseClient';
import { on } from 'svelte/events';

let initialized = false;

export async function initializeDatabase() {
	if (initialized) return; // only runs once
	initialized = true;

	console.log('Initializing database for a new game');

	const { data, error } = await supabase.from('game').insert([{}]).select();

	if (error) {
		console.error('error inintializing database:', error)
	} else {
		const prompt = await assignPromptToGame(data[0].id);
		console.log('new game added successfully:', data[0].id)
	}

	return data;
}


export async function addUserToLatestGame(username, authData) {
    if (!username) {
        throw new Error('Username is required');
    }

    // 1. Get the currently signed-in user's ID
    if (!authData) {
        throw new Error('no auth data for some reason');
    }


    // 2. Fetch the most recently created game
    const { data: latestGame, error: gameError } = await supabase
        .from('game')
        .select('id')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

    if (gameError) {
        console.error('Error fetching the latest game:', gameError);
        throw gameError;
    }

    const gameId = latestGame.id;

    // 3. Insert the profile into the database
    const { error: profileError } = await supabase.from('profiles').insert([
        { id: authData.id, username: username, game_id: gameId }
    ]);

    if (profileError) {
        console.error('Error adding profile:', profileError);
        throw profileError;
    }

    console.log(`User ${username} added to the latest game ${gameId}`);
}

export async function monitorPlayerCount(gameId, onReady, onPlayerCountChange) {
    // Fetch the current player count
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

    // Update the UI with the initial player count
    if (onPlayerCountChange) onPlayerCountChange(initialCount);

    // If there are already 2 or more players, trigger the callback
    if (initialCount >= 2) {
        onReady();
        return;
    }

    // Subscribe to changes in the profiles table
    const subscription = supabase
        .channel('player-count')
        .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'profiles', filter: `game_id=eq.${gameId}` },
            (payload) => {
                console.log('New player joined:', payload.new);

                // Increment the player count dynamically
                const newCount = initialCount + 1;
                if (onPlayerCountChange) onPlayerCountChange(newCount);

                // Redirect if 2 or more players are now present
                if (newCount >= 2) {
                    onReady();
                }
            }
        )
        .subscribe();

    return () => {
        // Unsubscribe when the component unmounts or cleanup is required
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

    // Select a random prompt in JavaScript
    const randomIndex = Math.floor(Math.random() * prompts.length);
    return prompts[randomIndex];
}


export async function assignPromptToGame(gameId) {
    const prompt = await fetchPrompt(); // Fetch a random prompt

    // Update the game with the selected prompt ID
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


export async function fetchPromptForCurrentGame() {
    // Fetch the latest game
    const { data: latestGame, error: gameError } = await supabase
        .from('game')
        .select('prompt_id')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

    if (gameError) {
        console.error('Error fetching the latest game:', gameError);
        throw gameError;
    }

    if (!latestGame.prompt_id) {
        throw new Error('No prompt assigned to the current game');
    }

    // Fetch the prompt associated with the game
    const { data: prompt, error: promptError } = await supabase
        .from('prompts')
        .select('*')
        .eq('id', latestGame.prompt_id)
        .single();

    if (promptError) {
        console.error('Error fetching prompt for game:', promptError);
        throw promptError;
    }

    return prompt;
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
    //Mapping responses to a simpler structure
    return data.map((r) => ({
        id: r.id, // Keep the same 'id' from the database row
        response: r.text, // Rename 'text' to 'response' for clarity in our front-end
        vote_count: r.votes ? r.votes[0].count : 0, // 'votes' is an array containing an object like { count: number }.
        // If 'votes' exists, we use votes[0].count; otherwise, default to 0.
      }));
    }

export async function voteForResponse(responseId, userId, gameId) {
    console.log('vote for response called');
    // first add vote to votes table
    const { error } = await supabase
        .from('votes')
        .insert([{ response_id: responseId, user_id: userId, game_id: gameId }]);

    if (error) {
        console.error('Error casting vote:', error);
        return { error: 'Error submitting vote' };
    }

    // update the voting status of the player to true
    const { updateError } = await supabase
        .from('profiles')
        .update({voted:true})
        .eq('id', userId);

    console.log('check at this point to see if the player voted database has been updated')

    if (updateError) {
        console.error('Error updating voting status of player', updateError);
        return { error: 'Error updating voting status'}
    }

    console.log(`User ${userId} voted for response ${responseId}`);
    // Now check if all players have voted; return that flag
    const allVoted = await checkAllVoted(gameId);
    return { allVoted };
}

export async function checkAllVoted (gameId) {
    // check if all players have voted
    const {data:players, error:countError} = await supabase
        .from('profiles')
        .select('voted')
        .eq('game_id', gameId);

    console.log('player vote statuses should have been gotten');
    console.log(players);

    if (countError) {
        console.error('Error counting the votes', countError);
        return { error: 'Error counting votes' };
    }

    const allVoted = players.every(player => player.voted);
    console.log('all voted?', allVoted);
    return allVoted;
}
export async function calculateGameScores(gameId) {
    // Fetch votes for the game from the 'votes' table.
    const { data: votes, error: votesError } = await supabase
      .from('votes')
      .select('response_id')
      .eq('game_id', gameId);
    if (votesError) throw votesError;
  
    // Tally the votes for each response.
    const voteCounts = {};
    votes.forEach(vote => {
      voteCounts[vote.response_id] = (voteCounts[vote.response_id] || 0) + 1;
    });
  
    // Fetch responses for the game to know which player submitted which response.
    const { data: responses, error: responsesError } = await supabase
      .from('responses')
      .select('id, player_id')
      .eq('game_id', gameId);
    if (responsesError) throw responsesError;
  
    let winningPlayer = null; // Will hold the player_id of the winning response.
    let maxVotes = 0;         // Highest vote count.
    let runnerUpVotes = 0;    // Second highest vote count.
  
    // Loop through each response to find the winning one.
    responses.forEach(response => {
      const count = voteCounts[response.id] || 0;
      if (count > maxVotes) {
        runnerUpVotes = maxVotes; // Update runner-up before setting new max.
        maxVotes = count;
        winningPlayer = response.player_id;
      } else if (count > runnerUpVotes) {
        runnerUpVotes = count;
      }
    });
  
    // Calculate the bonus points.
    const difference = maxVotes - runnerUpVotes;
    const points = difference * 100;
  
    // If there is a winning player and bonus points to award, update their score.
    if (winningPlayer && points > 0) {
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('score')
        .eq('id', winningPlayer)
        .single();
      if (profileError) throw profileError;
      const currentScore = profileData.score || 0;
      const newScore = currentScore + points;
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ score: newScore })
        .eq('id', winningPlayer);
      if (updateError) throw updateError;
  
      // Log the score update (minimal logging)
      console.log(`Score updated for player ${winningPlayer}: +${points} points`);
      return { winningPlayer, points, voteCounts };
    }
    
    console.log("No score update necessary.");
    return { winningPlayer, points, voteCounts };
  }

export function subscribeToVotes(gameId, onUpdate) {
    const subscription = supabase
        .channel('votes')
        .on(
            'postgres_changes',
            { 
                event: '*', 
                schema: 'public', 
                table: 'votes', 
                filter: `game_id=eq.${gameId}` 
            },
            async () => {
                console.log('Votes updated, refreshing responses');
                const updatedResponses = await fetchResponsesForGame(gameId);
                onUpdate(updatedResponses);
            }
        )
        .subscribe();

    return () => supabase.removeChannel(subscription);
}


export async function fetchCurrentGameId() {
    const { data: latestGame, error } = await supabase
        .from('game')
        .select('id')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

    if (error) {
        console.error('Error fetching the current game ID:', error);
        throw error;
    }

    return latestGame.id;

}

export async function fetchWinningResponse(gameId) {
    let responses = [];
    const { data, error } = await supabase
      .from("responses")
      .select(
        `
                id,
                text,
                player_id,
                game_id,
                votes:votes(count)
            `
      )
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

    if (responses.length === 0){
        return null;
    }

    if (responses.length > 0) {
        // Determine winner
        let winningResponse = responses.reduce(
            (max, response) => response.vote_count > max.vote_count ? response : max, 
            responses[0]
        );

        // If there are only 1 or 2 responses, losingResponse might not exist
        let losingResponse = responses.find(r => r.id !== winningResponse.id) || { vote_count: 0 };

        // Fetch player usernames
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
