import React from 'react';
import { Card, CardContent, Avatar, Typography, Badge, IconButton, Tooltip, Box, Chip } from '@mui/material';
import { Mic, MicOff, PersonRemove } from '@mui/icons-material';

const kickPulseSx = {
    color: 'error.main',
    animation: 'kickPulse 1s ease-in-out infinite',
    '@keyframes kickPulse': {
        '0%': { opacity: 1 },
        '50%': { opacity: 0.35 },
        '100%': { opacity: 1 },
    },
};

function ExpelButton({ size, onVote, id, alreadyVotedInRound, tooltip }) {
    return (
        <Tooltip title={tooltip}>
            <span>
                <IconButton
                    size={size}
                    onClick={() => onVote(id)}
                    disabled={alreadyVotedInRound}
                    sx={alreadyVotedInRound ? { color: 'error.main' } : kickPulseSx}
                >
                    <PersonRemove fontSize={size} />
                </IconButton>
            </span>
        </Tooltip>
    );
}

function MuteButton({ size, isMe, isMuted, onToggleMute }) {
    return (
        <IconButton size={size} color="primary" disabled={!isMe} onClick={onToggleMute}>
            {isMuted ? <MicOff fontSize={size} /> : <Mic fontSize={size} />}
        </IconButton>
    );
}

function ParticipantCard({
    id,
    user,
    isMe,
    isMuted,
    voteActive,
    votesAgainst,
    canVoteForThisUser,
    hasVotedForThisUser,
    alreadyVotedInRound,
    onToggleMute,
    onVote,
    density = 'spacious',
}) {
    const isGhost = user.status === 'disconnected';
    // Firebase is an external, realtime-writable boundary: a node can theoretically
    // be observed mid-write (or written by a stale cached client) before it has a
    // username. Falling back here keeps one bad record from crashing the whole room.
    const username = user.username || '???';
    const showExpelIcon = voteActive && canVoteForThisUser;
    const expelTooltip = alreadyVotedInRound
        ? (hasVotedForThisUser ? 'Tu voto' : 'Ya votaste')
        : `Votar para expulsar a ${username}`;

    // --- Vista C: ultra-minimalista (7-9 en mobile) — sólo avatar + nombre recortado ---
    if (density === 'minimal') {
        return (
            <Card
                raised={!isGhost}
                sx={{ p: 1, position: 'relative', textAlign: 'center', opacity: isGhost ? 0.5 : 1, transition: 'opacity 0.3s ease' }}
            >
                <Badge
                    badgeContent={user.nominations || 0}
                    color="warning"
                    showZero
                    overlap="circular"
                    anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
                >
                    <Badge
                        badgeContent={votesAgainst}
                        color="error"
                        invisible={!(voteActive && votesAgainst > 0)}
                        overlap="circular"
                        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
                    >
                        <Avatar sx={{ width: 44, height: 44, mx: 'auto', bgcolor: 'secondary.main', fontSize: '1rem' }}>
                            {username.charAt(0).toUpperCase()}
                        </Avatar>
                    </Badge>
                </Badge>
                <Typography variant="caption" noWrap sx={{ display: 'block', mt: 0.5, maxWidth: 72, mx: 'auto' }}>
                    {isMe ? 'Tú' : username}
                </Typography>
                {isGhost && (
                    <Typography variant="caption" color="warning.main" sx={{ display: 'block' }}>
                        Reconectando…
                    </Typography>
                )}
                <Box sx={{ display: 'flex', justifyContent: 'center', gap: 0.5, mt: 0.5 }}>
                    <MuteButton size="small" isMe={isMe} isMuted={isMuted} onToggleMute={onToggleMute} />
                    {showExpelIcon && (
                        <ExpelButton size="small" onVote={onVote} id={id} alreadyVotedInRound={alreadyVotedInRound} tooltip={expelTooltip} />
                    )}
                </Box>
            </Card>
        );
    }

    // --- Vista B: compacta en lista horizontal (5-6 en mobile) ---
    if (density === 'compact') {
        return (
            <Card raised={!isGhost} sx={{ p: 1.5, opacity: isGhost ? 0.5 : 1, transition: 'opacity 0.3s ease' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <Avatar sx={{ width: 52, height: 52, bgcolor: 'secondary.main', flexShrink: 0 }}>
                        {username.charAt(0).toUpperCase()}
                    </Avatar>
                    <Box sx={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                        <Typography variant="subtitle1" noWrap sx={{ fontWeight: isMe ? 'bold' : 'normal' }}>
                            {username}{isMe && ' (Tú)'}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" component="span">
                            Nominaciones: {user.nominations || 0}
                        </Typography>
                        {voteActive && votesAgainst > 0 && (
                            <Chip label={`Votos: ${votesAgainst}`} size="small" sx={{ ml: 1 }} />
                        )}
                        {isGhost && <Chip label="Reconectando…" size="small" color="warning" sx={{ ml: 1 }} />}
                    </Box>
                    <Box sx={{ display: 'flex', gap: 0.5, flexShrink: 0 }}>
                        <MuteButton size="small" isMe={isMe} isMuted={isMuted} onToggleMute={onToggleMute} />
                        {showExpelIcon && (
                            <ExpelButton size="small" onVote={onVote} id={id} alreadyVotedInRound={alreadyVotedInRound} tooltip={expelTooltip} />
                        )}
                    </Box>
                </Box>
            </Card>
        );
    }

    // --- Vista A: espaciosa (por defecto en desktop, y hasta 4 en mobile) ---
    return (
        <Card
            raised={!isGhost}
            sx={{
                p: 2,
                position: 'relative',
                textAlign: 'center',
                opacity: isGhost ? 0.5 : 1,
                transition: 'opacity 0.3s ease',
            }}
        >
            {isMe && (
                <Typography sx={{ position: 'absolute', top: 8, right: 8, color: 'primary.main', fontWeight: 'bold' }}>
                    Tú
                </Typography>
            )}
            {isGhost && (
                <Chip label="Reconectando..." size="small" color="warning" sx={{ position: 'absolute', top: 8, left: 8 }} />
            )}

            <Avatar sx={{ width: 80, height: 80, mb: 1, mx: 'auto', bgcolor: 'secondary.main' }}>
                {username.charAt(0).toUpperCase()}
            </Avatar>

            <CardContent sx={{ p: 0 }}>
                <Typography variant="h6">{username}</Typography>

                <Badge
                    badgeContent={user.nominations || 0}
                    color="warning"
                    showZero
                    sx={{ mt: 0.5, mb: 1, '& .MuiBadge-badge': { right: -12 } }}
                >
                    <Typography variant="caption" color="text.secondary">
                        Historial de nominaciones
                    </Typography>
                </Badge>

                {voteActive && votesAgainst > 0 && (
                    <Box>
                        <Chip label={`Votos: ${votesAgainst}`} size="small" sx={{ mt: 1 }} />
                    </Box>
                )}

                <Box>
                    <MuteButton size="medium" isMe={isMe} isMuted={isMuted} onToggleMute={onToggleMute} />
                    {showExpelIcon && (
                        <ExpelButton size="medium" onVote={onVote} id={id} alreadyVotedInRound={alreadyVotedInRound} tooltip={expelTooltip} />
                    )}
                </Box>
            </CardContent>
        </Card>
    );
}

export default ParticipantCard;
