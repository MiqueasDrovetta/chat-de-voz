import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Container, Typography, Box, Grid, IconButton, Tooltip, Snackbar, Button } from '@mui/material';
import { ContentCopy } from '@mui/icons-material';
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

    const { now, serverNow } = useServerTime();

    const {
        myPeerId,
        users,
        audioStreams,
        isMuted,
        kicked,
        myAudioRef,
        toggleMute,
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
                navigate(`/${availableRoomId}?username=${username}`);
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
            navigate(`/${newRoomId}?username=${username}`);
        } catch (error) {
            console.error('Error creando sala:', error);
        }
    };

    const handleGoHome = () => navigate('/');

    // --- RENDER ---

    const activeUserCount = countActiveUsers(users);
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

            <Box sx={{ my: 4, textAlign: 'center' }}>
                <Typography variant="h4" component="h1" display="inline-block">Sala: </Typography>
                <Typography variant="h4" component="h1" display="inline-block" sx={{ fontWeight: 'bold' }}>{roomId}</Typography>
                <Tooltip title="Copiar ID de la sala">
                    <IconButton onClick={() => { navigator.clipboard.writeText(roomId); notify('ID de la sala copiado'); }}>
                        <ContentCopy />
                    </IconButton>
                </Tooltip>
            </Box>
            <Typography align="center" paragraph>{activeUserCount} de {MAX_USERS_PER_ROOM} participantes.</Typography>

            <Grid container spacing={3} justifyContent="center">
                {Object.entries(users).map(([id, user]) => {
                    const votesAgainst = vote?.votes?.[id] ? Object.keys(vote.votes[id]).length : 0;
                    const hasVotedForThisUser = !!vote?.votes?.[id]?.[myPeerId];
                    const alreadyVotedInRound = !!vote && Object.values(vote.votes || {}).some((voters) => voters[myPeerId]);
                    const canVoteForThisUser = !!vote && isActiveUser(user) && vote.initiator !== id && myPeerId !== id;

                    return (
                        <Grid item xs={12} sm={6} md={4} lg={3} key={id}>
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
                            />
                        </Grid>
                    );
                })}
            </Grid>

            {!vote && (
                <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
                    <Tooltip title={startVoteTooltip}>
                        <span>
                            <Button variant="contained" onClick={handleStartVote} disabled={startVoteDisabled}>
                                {startVoteLabel}
                            </Button>
                        </span>
                    </Tooltip>
                </Box>
            )}

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
