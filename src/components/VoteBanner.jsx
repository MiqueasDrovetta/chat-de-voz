import React, { useEffect, useState } from 'react';
import { Box, Alert, LinearProgress, Slide } from '@mui/material';

function getLeadingNominee(vote, users) {
    if (!vote?.votes) return null;
    let leadingId = null;
    let maxVotes = 0;
    Object.entries(vote.votes).forEach(([targetId, voters]) => {
        const count = Object.keys(voters || {}).length;
        if (count > maxVotes) {
            maxVotes = count;
            leadingId = targetId;
        }
    });
    if (!leadingId) return null;
    return users[leadingId]?.username || null;
}

function VoteBanner({ vote, users, now, durationMs, onVisibilityChange }) {
    // Keeps rendering the last known vote while the exit animation plays,
    // so the banner slides away instead of vanishing mid-transition.
    const [displayVote, setDisplayVote] = useState(vote);
    if (vote && vote !== displayVote) {
        setDisplayVote(vote);
    }

    // Lets the parent hold its layout (e.g. Container padding) until the exit
    // transition actually finishes, instead of collapsing the instant vote goes null.
    useEffect(() => {
        onVisibilityChange?.(!!displayVote);
    }, [displayVote, onVisibilityChange]);

    if (!displayVote) return null;

    const leadingUsername = getLeadingNominee(displayVote, users);
    const remainingMs = Math.max(0, displayVote.endTime - now);
    const progress = Math.min(100, Math.max(0, (remainingMs / durationMs) * 100));

    return (
        <Slide direction="down" in={!!vote} mountOnEnter unmountOnExit onExited={() => setDisplayVote(null)}>
            <Box sx={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 1300 }}>
                <Alert severity="warning" variant="filled" sx={{ borderRadius: 0, justifyContent: 'center' }}>
                    {leadingUsername
                        ? `Votación para expulsar a ${leadingUsername}`
                        : 'Votación en curso para expulsar a un participante'}
                    {' · '}
                    {Math.ceil(remainingMs / 1000)}s
                </Alert>
                <LinearProgress variant="determinate" value={progress} color="warning" sx={{ height: 6 }} />
            </Box>
        </Slide>
    );
}

export default VoteBanner;
