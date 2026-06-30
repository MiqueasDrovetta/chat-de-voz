import React from 'react';
import { Box, Alert, LinearProgress } from '@mui/material';

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

function VoteBanner({ vote, users, now, durationMs }) {
    if (!vote) return null;

    const leadingUsername = getLeadingNominee(vote, users);
    const remainingMs = Math.max(0, vote.endTime - now);
    const progress = Math.min(100, Math.max(0, (remainingMs / durationMs) * 100));

    return (
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
    );
}

export default VoteBanner;
