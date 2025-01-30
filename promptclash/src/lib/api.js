import { supabase } from '$lib/supabaseClient';

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
    const { data: responses, error } = await supabase
        .from('responses')
        .select('*')
        .eq('game_id', gameId);

    if (error) {
        console.error('Error fetching responses:', error);
        throw error;
    }

    return responses;
}

export async function voteForResponse(responseId, userId, gameId) {

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

    if (updateError) {
        console.error('Error updating voting status of player', updateError);
        return { error: 'Error updating voting status'}
    }

    console.log(`User ${userId} voted for response ${responseId}`);

    // check if all players have voted
    const {data:players, error:countError} = await supabase
        .from('profiles')
        .select('voted')
        .eq('game_id', gameId);

    if (countError) {
        console.error('Error counting the votes', countError);
        return { error: 'Error counting votes' };
    }

    const allVoted = players.every(player => player.voted);
    if (allVoted) {
        console.log('All players have voted');
        return {allVoted: true};
    } else {
        return {allVoted: false};
    }

}


export function subscribeToVotes(gameId, onUpdate) {
    const subscription = supabase
        .channel('votes')
        .on(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'responses', filter: `game_id=eq.${gameId}` },
            (payload) => {
                console.log('Vote updated:', payload.new);
                onUpdate(payload.new); // Call the callback with the updated response
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