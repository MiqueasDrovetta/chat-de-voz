import React from 'react';
import { Card, CardContent, Avatar, Typography, Badge, IconButton, Tooltip, Box, Chip } from '@mui/material';
import { Mic, MicOff, PersonRemove } from '@mui/icons-material';

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
}) {
    const isGhost = user.status === 'disconnected';

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
                {user.username.charAt(0).toUpperCase()}
            </Avatar>

            <CardContent sx={{ p: 0 }}>
                <Typography variant="h6">{user.username}</Typography>

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
                    <IconButton color="primary" disabled={!isMe} onClick={onToggleMute}>
                        {isMuted ? <MicOff /> : <Mic />}
                    </IconButton>

                    {voteActive && canVoteForThisUser && (
                        <Tooltip title={alreadyVotedInRound ? (hasVotedForThisUser ? 'Tu voto' : 'Ya votaste') : `Votar para expulsar a ${user.username}`}>
                            <span>
                                <IconButton
                                    onClick={() => onVote(id)}
                                    disabled={alreadyVotedInRound}
                                    sx={{
                                        color: 'error.main',
                                        ...(votesAgainst > 0 && !alreadyVotedInRound
                                            ? {
                                                  animation: 'kickPulse 1s ease-in-out infinite',
                                                  '@keyframes kickPulse': {
                                                      '0%': { opacity: 1 },
                                                      '50%': { opacity: 0.35 },
                                                      '100%': { opacity: 1 },
                                                  },
                                              }
                                            : {}),
                                    }}
                                >
                                    <PersonRemove />
                                </IconButton>
                            </span>
                        </Tooltip>
                    )}
                </Box>
            </CardContent>
        </Card>
    );
}

export default ParticipantCard;
