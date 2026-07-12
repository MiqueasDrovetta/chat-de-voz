import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Container, Typography, Box, Grid, IconButton, Tooltip, Snackbar, Button, Paper, useMediaQuery, useTheme } from '@mui/material';
import { ContentCopy, ExitToApp } from '@mui/icons-material';
import {
    MAX_USERS_PER_ROOM,
    MIN_USERS_FOR_VOTE,
    VOTE_DURATION,
    GLOBAL_VOTE_COOLDOWN,
} from '../constants';
import { db } from '../firebase';
import { isActiveUser, countActiveUsers, findAvailableRoom, createRoom } from '../utils/rooms';
import { useServerTime } from '../hooks/useServerTime';
import { useWebRTCChat } from '../hooks/useWebRTCChat';
import { useVoteSystem } from '../hooks/useVoteSystem';
import ParticipantCard from '../components/ParticipantCard';
import VoteBanner from '../components/VoteBanner';
import KickedDialog from '../components/KickedDialog';

function Room() {
    const { roomId } = useParams();
    const navigate = useNavigate();
    const location = useLocation();

    const username = new URLSearchParams(location.search).get('username') || '';

    const [notification, setNotification] = useState({ open: false, message: '' });
    const [kickedStage, setKickedStage] = useState('kicked');
    const [isSearchingRoom, setIsSearchingRoom] = useState(false);
    const [bannerVisible, setBannerVisible] = useState(false);

    const notify = (message) => setNotification({ open: true, message });

    // Resets the post-kick dialog stage whenever we land in a (new) room.
    const roomKey = `${roomId}:${username}`;
    const [lastRoomKey, setLastRoomKey] = useState(roomKey);
    if (roomKey !== lastRoomKey) {
        setLastRoomKey(roomKey);
        setKickedStage('kicked');
        setIsSearchingRoom(false);
    }

    useEffect(() => {
        if (!username) navigate('/');
    }, [username, navigate]);

    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

    const { now, serverNow } = useServerTime();

    const {
        myPeerId,
        users,
        audioStreams,
        isMuted,
        kicked,
        myAudioRef,
        toggleMute,
        leaveRoom,
    } = useWebRTCChat({ roomId, username, navigate, serverNow });

    const {
        vote,
        lastGlobalVoteTime,
        userCooldownRemaining,
        handleStartVote,
        handleCastVote,
    } = useVoteSystem({ roomId, myPeerId, users, now, serverNow, notify });

    // --- POST-KICK FLOW ---

    const handleSearchAnotherRoom = async () => {
        setIsSearchingRoom(true);
        try {
            const availableRoomId = await findAvailableRoom(db);
            setIsSearchingRoom(false);
            if (availableRoomId) {
                navigate(`/${availableRoomId}?username=${encodeURIComponent(username)}`);
            } else {
                setKickedStage('noRoomsAvailable');
            }
        } catch (error) {
            console.error('Error buscando otra sala:', error);
            setIsSearchingRoom(false);
        }
    };

    const handleCreateNewRoom = async () => {
        try {
            const newRoomId = await createRoom(db);
            navigate(`/${newRoomId}?username=${encodeURIComponent(username)}`);
        } catch (error) {
            console.error('Error creando sala:', error);
        }
    };

    const handleGoHome = () => navigate('/');

    // "Salir" (voluntary exit, as opposed to a microcut): awaits the real removal
    // from Firebase and full peer/track teardown before navigating away, instead
    // of only relying on the effect cleanup that unmounting would trigger anyway.
    const handleLeaveRoom = async () => {
        await leaveRoom();
        navigate('/');
    };

    // --- RENDER ---

    const activeUserCount = countActiveUsers(users);

    // Nivel de densidad de la grilla para que los 9 cupos quepan sin scroll en un
    // celular: sólo aplica en xs (mobile); en pantallas más grandes siempre se usa
    // la tarjeta completa, ya que ahí sobra espacio para cualquier cantidad. Se basa
    // en participantes ACTIVOS (no en el total con fantasmas) para que un usuario
    // reconectando no dispare dos reacomodos de la grilla en su ventana de gracia
    // de 10s: uno al desconectarse y otro al purgarse.
    const tier = activeUserCount <= 4 ? 'spacious' : activeUserCount <= 6 ? 'compact' : 'minimal';
    const density = isMobile ? tier : 'spacious';
    const gridXs = { spacious: 6, compact: 6, minimal: 4 }[tier];
    const myHasInitiatedVote = !!users[myPeerId]?.hasInitiatedVote;
    const globalCooldownRemainingMs = Math.max(0, GLOBAL_VOTE_COOLDOWN * 1000 - (now - (lastGlobalVoteTime || 0)));
    const notEnoughUsersForVote = activeUserCount < MIN_USERS_FOR_VOTE;
    const globalCooldownActive = globalCooldownRemainingMs > 0;
    const startVoteDisabled = notEnoughUsersForVote || globalCooldownActive || myHasInitiatedVote;

    let startVoteLabel = 'Iniciar Votación';
    let startVoteTooltip = 'Iniciar una votación para expulsar a un miembro';
    if (myHasInitiatedVote) {
        const mm = String(Math.floor(userCooldownRemaining / 60)).padStart(2, '0');
        const ss = String(userCooldownRemaining % 60).padStart(2, '0');
        startVoteLabel = `Enfriamiento ${mm}:${ss}`;
        startVoteTooltip = 'Ya has iniciado una votación recientemente';
    } else if (notEnoughUsersForVote) {
        startVoteTooltip = `Se necesitan al menos ${MIN_USERS_FOR_VOTE} participantes para iniciar una votación.`;
    } else if (globalCooldownActive) {
        startVoteLabel = `Sala en enfriamiento (${Math.ceil(globalCooldownRemainingMs / 1000)}s)`;
        startVoteTooltip = 'La sala está en cooldown global tras la última votación.';
    }

    return (
        <Container sx={{ pt: bannerVisible ? 8 : 0 }}>
            <VoteBanner
                vote={vote}
                users={users}
                now={now}
                durationMs={VOTE_DURATION * 1000}
                onVisibilityChange={setBannerVisible}
            />

            {/* Panel de control: siempre visible arriba de la grilla de participantes,
                para que "Iniciar Votación" (o su estado de cooldown) nunca quede
                oculto por scroll cuando la sala tiene varios usuarios. */}
            <Paper elevation={3} sx={{ my: 4, py: 3, px: 2, textAlign: 'center' }}>
                <Box>
                    <Typography variant="h4" component="h1" display="inline-block">Sala: </Typography>
                    <Typography variant="h4" component="h1" display="inline-block" sx={{ fontWeight: 'bold' }}>{roomId}</Typography>
                    <Tooltip title="Copiar ID de la sala">
                        <IconButton onClick={() => { navigator.clipboard.writeText(roomId); notify('ID de la sala copiado'); }}>
                            <ContentCopy />
                        </IconButton>
                    </Tooltip>
                </Box>
                <Box sx={{ mb: 1 }}>
                    <Button
                        variant="outlined"
                        color="error"
                        size="small"
                        startIcon={<ExitToApp />}
                        onClick={handleLeaveRoom}
                    >
                        Salir
                    </Button>
                </Box>
                <Typography align="center" paragraph>{activeUserCount} de {MAX_USERS_PER_ROOM} participantes.</Typography>

                {!vote && (
                    <Tooltip title={startVoteTooltip}>
                        <span>
                            <Button variant="contained" size="large" onClick={handleStartVote} disabled={startVoteDisabled}>
                                {startVoteLabel}
                            </Button>
                        </span>
                    </Tooltip>
                )}
            </Paper>

            <Grid container spacing={density === 'minimal' ? 1 : 3} justifyContent="center">
                {Object.entries(users).map(([id, user]) => {
                    const votesAgainst = vote?.votes?.[id] ? Object.keys(vote.votes[id]).length : 0;
                    const hasVotedForThisUser = !!vote?.votes?.[id]?.[myPeerId];
                    const alreadyVotedInRound = !!vote && Object.values(vote.votes || {}).some((voters) => voters[myPeerId]);
                    const canVoteForThisUser = !!vote && isActiveUser(user) && vote.initiator !== id && myPeerId !== id;

                    return (
                        <Grid size={{ xs: gridXs, sm: 6, md: 4, lg: 3 }} key={id}>
                            <ParticipantCard
                                id={id}
                                user={user}
                                isMe={id === myPeerId}
                                isMuted={id === myPeerId ? isMuted : !!user.isMuted}
                                voteActive={!!vote}
                                votesAgainst={votesAgainst}
                                canVoteForThisUser={canVoteForThisUser}
                                hasVotedForThisUser={hasVotedForThisUser}
                                alreadyVotedInRound={alreadyVotedInRound}
                                onToggleMute={toggleMute}
                                onVote={handleCastVote}
                                density={density}
                            />
                        </Grid>
                    );
                })}
            </Grid>

            <audio ref={myAudioRef} muted autoPlay playsInline />
            {Object.entries(audioStreams).map(([peerId, stream]) => (
                <audio key={peerId} autoPlay playsInline ref={(el) => { if (el) el.srcObject = stream; }} />
            ))}

            <Snackbar
                open={notification.open}
                autoHideDuration={4000}
                onClose={() => setNotification((prev) => ({ ...prev, open: false }))}
                message={notification.message}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            />

            <KickedDialog
                open={kicked}
                stage={kickedStage}
                isSearching={isSearchingRoom}
                onSearchRoom={handleSearchAnotherRoom}
                onCreateRoom={handleCreateNewRoom}
                onGoHome={handleGoHome}
            />
        </Container>
    );
}

export default Room;
