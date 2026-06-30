import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Container, Typography, Box, Grid, IconButton, Tooltip, Snackbar, Button } from '@mui/material';
import { ContentCopy } from '@mui/icons-material';
import Peer from 'peerjs';
import { db } from '../firebase';
import { ref, onValue, onDisconnect, set, remove, runTransaction, get, serverTimestamp } from 'firebase/database';
import {
    MAX_USERS_PER_ROOM,
    MIN_USERS_FOR_VOTE,
    VOTE_DURATION,
    USER_VOTE_COOLDOWN,
    GLOBAL_VOTE_COOLDOWN,
    RECONNECT_GRACE_MS,
} from '../constants';
import { isActiveUser, countActiveUsers, findAvailableRoom, createRoom } from '../utils/rooms';
import ParticipantCard from '../components/ParticipantCard';
import VoteBanner from '../components/VoteBanner';
import KickedDialog from '../components/KickedDialog';

function Room() {
    const { roomId } = useParams();
    const navigate = useNavigate();
    const location = useLocation();

    const [username, setUsername] = useState('');
    const [myPeerId, setMyPeerId] = useState('');
    const [users, setUsers] = useState({});
    const [audioStreams, setAudioStreams] = useState({});
    const [isMuted, setIsMuted] = useState(false);
    const [notification, setNotification] = useState({ open: false, message: '' });
    const [vote, setVote] = useState(null);
    const [lastGlobalVoteTime, setLastGlobalVoteTime] = useState(0);
    const [userCooldownRemaining, setUserCooldownRemaining] = useState(0);
    const [now, setNow] = useState(Date.now());
    const [kicked, setKicked] = useState(false);
    const [kickedStage, setKickedStage] = useState('kicked');
    const [isSearchingRoom, setIsSearchingRoom] = useState(false);

    const myAudioRef = useRef(null);
    const peerRef = useRef(null);
    const myStreamRef = useRef(null);
    const connections = useRef({});
    const userCooldownTimer = useRef(null);
    const ghostTimers = useRef({});
    const prevUsersRef = useRef({});
    const prevUserCount = useRef(0);
    const serverOffsetRef = useRef(0);
    const storageKey = `voiceChat:${roomId}`;

    const serverNow = () => Date.now() + serverOffsetRef.current;

    // --- TIME SYNC & TICK ---

    useEffect(() => {
        const offsetNodeRef = ref(db, '.info/serverTimeOffset');
        const unsubscribe = onValue(offsetNodeRef, (snapshot) => {
            serverOffsetRef.current = snapshot.val() || 0;
        });
        return () => unsubscribe();
    }, []);

    useEffect(() => {
        const id = setInterval(() => setNow(serverNow()), 1000);
        return () => clearInterval(id);
    }, []);

    // --- WEBRTC ---

    const handleWebRTCConnections = (allUsers, selfId, myStream) => {
        const stream = myStream || myStreamRef.current;
        if (!stream || !peerRef.current) return;

        Object.keys(allUsers).forEach((peerId) => {
            if (peerId !== selfId && isActiveUser(allUsers[peerId]) && !connections.current[peerId]) {
                const call = peerRef.current.call(peerId, stream);
                if (call) {
                    call.on('stream', (remoteStream) => {
                        setAudioStreams((prev) => ({ ...prev, [peerId]: remoteStream }));
                    });
                    call.on('close', () => {
                        delete connections.current[peerId];
                        setAudioStreams((prev) => {
                            const next = { ...prev };
                            delete next[peerId];
                            return next;
                        });
                    });
                    connections.current[peerId] = call;
                }
            }
        });

        Object.keys(connections.current).forEach((peerId) => {
            if (!allUsers[peerId]) {
                connections.current[peerId]?.close();
                delete connections.current[peerId];
                setAudioStreams((prev) => {
                    const next = { ...prev };
                    delete next[peerId];
                    return next;
                });
            }
        });
    };

    // --- KICK DETECTION ---

    const handleKicked = () => {
        Object.values(connections.current).forEach((call) => call.close());
        connections.current = {};
        myStreamRef.current?.getTracks().forEach((track) => track.stop());
        peerRef.current?.destroy();
        peerRef.current = null;
        setAudioStreams({});
        sessionStorage.removeItem(storageKey);
        setKickedStage('kicked');
        setKicked(true);
    };

    // --- GHOST (RECONNECT GRACE) CLEANUP ---

    const purgeGhost = (id) => {
        runTransaction(ref(db, `rooms/${roomId}/users/${id}`), (user) => {
            if (user && user.status === 'disconnected') return null;
            return user;
        });
    };

    // --- INITIALIZATION ---

    useEffect(() => {
        const queryParams = new URLSearchParams(location.search);
        const userParam = queryParams.get('username');
        if (!userParam) { navigate('/'); return; }

        let cancelled = false;

        setUsername(userParam);
        setKicked(false);
        setKickedStage('kicked');
        setIsMuted(false);
        setVote(null);
        setUsers({});
        setAudioStreams({});
        prevUsersRef.current = {};
        prevUserCount.current = 0;
        Object.values(ghostTimers.current).forEach(clearTimeout);
        ghostTimers.current = {};

        const createAndConnectPeer = (preferredId) => {
            const newPeer = preferredId ? new Peer(preferredId) : new Peer();
            peerRef.current = newPeer;

            newPeer.on('error', (err) => {
                console.error('Error de Peer:', err);
                if (err.type === 'unavailable-id' && preferredId) {
                    sessionStorage.removeItem(storageKey);
                    newPeer.destroy();
                    if (!cancelled) createAndConnectPeer(null);
                }
            });

            newPeer.on('open', (id) => {
                if (cancelled) return;
                setMyPeerId(id);
                sessionStorage.setItem(storageKey, JSON.stringify({ username: userParam, peerId: id }));

                const userRef = ref(db, `rooms/${roomId}/users/${id}`);
                onDisconnect(userRef).update({ status: 'disconnected', disconnectedAt: serverTimestamp() });

                get(ref(db, `rooms/${roomId}/nominations/${id}`)).then((nomSnapshot) => {
                    set(userRef, {
                        username: userParam,
                        isMuted: false,
                        nominations: nomSnapshot.val() || 0,
                        hasInitiatedVote: false,
                        status: 'connected',
                        disconnectedAt: null,
                    });
                });

                navigator.mediaDevices.getUserMedia({ audio: true, video: false })
                    .then((stream) => {
                        if (cancelled) { stream.getTracks().forEach((track) => track.stop()); return; }
                        myStreamRef.current = stream;
                        if (myAudioRef.current) myAudioRef.current.srcObject = stream;

                        newPeer.on('call', (call) => {
                            call.answer(stream);
                            call.on('stream', (remoteStream) => {
                                setAudioStreams((prev) => ({ ...prev, [call.peer]: remoteStream }));
                            });
                            connections.current[call.peer] = call;
                        });

                        get(ref(db, `rooms/${roomId}/users`)).then((snap) =>
                            handleWebRTCConnections(snap.val() || {}, id, stream)
                        );
                    })
                    .catch((err) => {
                        console.error('Failed to get media', err);
                        alert('No se pudo acceder al micrófono.');
                    });
            });
        };

        const initializeRoom = async () => {
            const usersSnapshot = await get(ref(db, `rooms/${roomId}/users`));
            const existingUsers = usersSnapshot.val() || {};
            if (countActiveUsers(existingUsers) >= MAX_USERS_PER_ROOM) {
                alert('La sala de chat está llena.');
                navigate('/');
                return;
            }
            if (cancelled) return;

            let storedSession = null;
            try {
                storedSession = JSON.parse(sessionStorage.getItem(storageKey));
            } catch {
                storedSession = null;
            }
            const reconnectPeerId = storedSession?.username === userParam ? storedSession.peerId : null;

            createAndConnectPeer(reconnectPeerId);
        };

        initializeRoom();

        return () => {
            cancelled = true;
            const idAtCleanup = peerRef.current?.id;
            if (idAtCleanup) {
                const userRef = ref(db, `rooms/${roomId}/users/${idAtCleanup}`);
                onDisconnect(userRef).cancel();
                remove(userRef);
            }
            sessionStorage.removeItem(storageKey);
            Object.values(connections.current).forEach((call) => call.close());
            connections.current = {};
            myStreamRef.current?.getTracks().forEach((track) => track.stop());
            peerRef.current?.destroy();
            peerRef.current = null;
            if (userCooldownTimer.current) clearInterval(userCooldownTimer.current);
            Object.values(ghostTimers.current).forEach(clearTimeout);
            ghostTimers.current = {};
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [roomId, navigate, location.search]);

    // --- ROOM USERS SUBSCRIPTION ---

    useEffect(() => {
        if (!myPeerId) return;

        const roomUsersRef = ref(db, `rooms/${roomId}/users`);
        const unsubscribe = onValue(roomUsersRef, (snapshot) => {
            const allUsers = snapshot.val() || {};

            if (prevUsersRef.current[myPeerId] && !allUsers[myPeerId] && !kicked) {
                prevUsersRef.current = allUsers;
                handleKicked();
                return;
            }
            prevUsersRef.current = allUsers;

            setUsers(allUsers);

            const currentUserCount = Object.keys(allUsers).length;
            if (currentUserCount > prevUserCount.current && allUsers[myPeerId]) {
                runTransaction(ref(db, `rooms/${roomId}/users/${myPeerId}`), (user) => {
                    if (user) user.hasInitiatedVote = false;
                    return user;
                });
            }
            prevUserCount.current = currentUserCount;

            const activeCount = countActiveUsers(allUsers);
            if (activeCount >= MAX_USERS_PER_ROOM) {
                Object.entries(allUsers).forEach(([id, user]) => {
                    if (!isActiveUser(user)) purgeGhost(id);
                });
            }

            Object.entries(allUsers).forEach(([id, user]) => {
                if (!isActiveUser(user) && !ghostTimers.current[id]) {
                    const disconnectedAt = user.disconnectedAt || serverNow();
                    const remaining = Math.max(0, RECONNECT_GRACE_MS - (serverNow() - disconnectedAt));
                    ghostTimers.current[id] = setTimeout(() => {
                        delete ghostTimers.current[id];
                        purgeGhost(id);
                    }, remaining);
                }
            });
            Object.keys(ghostTimers.current).forEach((id) => {
                if (!allUsers[id] || isActiveUser(allUsers[id])) {
                    clearTimeout(ghostTimers.current[id]);
                    delete ghostTimers.current[id];
                }
            });

            handleWebRTCConnections(allUsers, myPeerId);
        });
        return () => unsubscribe();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [myPeerId, roomId]);

    // --- VOTE SUBSCRIPTION ---

    useEffect(() => {
        const voteRef = ref(db, `rooms/${roomId}/vote`);
        const unsubscribe = onValue(voteRef, (snapshot) => {
            const currentVote = snapshot.val();
            setVote((prevVote) => {
                if (currentVote && !prevVote) {
                    setNotification({ open: true, message: '¡La votación ha comenzado!' });
                }
                return currentVote;
            });
        });
        return () => unsubscribe();
    }, [roomId]);

    useEffect(() => {
        const lastVoteRef = ref(db, `rooms/${roomId}/lastGlobalVoteTime`);
        const unsubscribe = onValue(lastVoteRef, (snapshot) => setLastGlobalVoteTime(snapshot.val() || 0));
        return () => unsubscribe();
    }, [roomId]);

    useEffect(() => {
        if (vote?.endTime && now >= vote.endTime) {
            handleEndVote();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [now, vote]);

    // --- INITIATOR LOCAL COOLDOWN (2 min) ---

    useEffect(() => {
        const myHasInitiated = !!users[myPeerId]?.hasInitiatedVote;
        if (myHasInitiated && !userCooldownTimer.current) {
            setUserCooldownRemaining(USER_VOTE_COOLDOWN);
            userCooldownTimer.current = setInterval(() => {
                setUserCooldownRemaining((prev) => {
                    if (prev <= 1) {
                        clearInterval(userCooldownTimer.current);
                        userCooldownTimer.current = null;
                        runTransaction(ref(db, `rooms/${roomId}/users/${myPeerId}`), (user) => {
                            if (user) user.hasInitiatedVote = false;
                            return user;
                        });
                        return 0;
                    }
                    return prev - 1;
                });
            }, 1000);
        } else if (!myHasInitiated && userCooldownTimer.current) {
            clearInterval(userCooldownTimer.current);
            userCooldownTimer.current = null;
            setUserCooldownRemaining(0);
        }
    }, [users, myPeerId, roomId]);

    // --- VOTING LOGIC ---

    const handleStartVote = async () => {
        if (countActiveUsers(users) < MIN_USERS_FOR_VOTE) return;

        const start = serverNow();
        if (start - (lastGlobalVoteTime || 0) < GLOBAL_VOTE_COOLDOWN * 1000) return;

        const { committed } = await runTransaction(ref(db, `rooms/${roomId}/users/${myPeerId}`), (user) => {
            if (user && !user.hasInitiatedVote) {
                user.hasInitiatedVote = true;
                return user;
            }
            return;
        });

        if (committed) {
            await set(ref(db, `rooms/${roomId}/vote`), { initiator: myPeerId, endTime: start + VOTE_DURATION * 1000, votes: {} });
            await set(ref(db, `rooms/${roomId}/lastGlobalVoteTime`), serverTimestamp());
        }
    };

    const handleCastVote = (targetId) => {
        if (!vote || vote.initiator === targetId || myPeerId === targetId) return;
        const alreadyVoted = Object.values(vote.votes || {}).some((voters) => voters[myPeerId]);
        if (alreadyVoted) {
            setNotification({ open: true, message: 'Ya has emitido tu voto en esta ronda.' });
            return;
        }
        set(ref(db, `rooms/${roomId}/vote/votes/${targetId}/${myPeerId}`), true);
    };

    const handleEndVote = () => {
        let outcome = null;

        runTransaction(ref(db, `rooms/${roomId}`), (room) => {
            if (!room || !room.vote) {
                outcome = null;
                return room;
            }

            const currentVote = room.vote;
            const usersInRoom = room.users || {};
            const activeUserCount = Object.values(usersInRoom).filter((u) => u && u.status !== 'disconnected').length;
            let maxVotes = 0;
            let userToKick = null;

            if (currentVote.votes) {
                Object.entries(currentVote.votes).forEach(([targetId, voters]) => {
                    const voteCount = Object.keys(voters).length;
                    if (voteCount > maxVotes) {
                        maxVotes = voteCount;
                        userToKick = targetId;
                    }
                });
            }

            if (userToKick && maxVotes > activeUserCount / 2) {
                outcome = { kicked: true, username: usersInRoom[userToKick]?.username };
                room.nominations = room.nominations || {};
                room.nominations[userToKick] = (room.nominations[userToKick] || 0) + 1;
                room.users[userToKick] = null;
            } else {
                outcome = { kicked: false };
            }

            room.vote = null;
            return room;
        }).then(({ committed }) => {
            if (!committed || !outcome) return;
            setNotification({
                open: true,
                message: outcome.kicked
                    ? `${outcome.username || 'Un usuario'} ha sido expulsado.`
                    : 'La votación ha terminado sin un resultado decisivo.',
            });
        });
    };

    const toggleMute = () => {
        const myStream = myStreamRef.current;
        if (myStream?.getAudioTracks().length > 0) {
            const isCurrentlyMuted = !myStream.getAudioTracks()[0].enabled;
            myStream.getAudioTracks()[0].enabled = isCurrentlyMuted;
            setIsMuted(!isCurrentlyMuted);
            runTransaction(ref(db, `rooms/${roomId}/users/${myPeerId}`), (user) => {
                if (user) user.isMuted = !isCurrentlyMuted;
                return user;
            });
        }
    };

    // --- POST-KICK FLOW ---

    const handleSearchAnotherRoom = async () => {
        setIsSearchingRoom(true);
        try {
            const availableRoomId = await findAvailableRoom(db);
            setIsSearchingRoom(false);
            if (availableRoomId) {
                navigate(`/chat-de-voz/${availableRoomId}?username=${username}`);
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
            navigate(`/chat-de-voz/${newRoomId}?username=${username}`);
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
        <Container sx={{ pt: vote ? 8 : 0 }}>
            <VoteBanner vote={vote} users={users} now={now} durationMs={VOTE_DURATION * 1000} />

            <Box sx={{ my: 4, textAlign: 'center' }}>
                <Typography variant="h4" component="h1" display="inline-block">Sala: </Typography>
                <Typography variant="h4" component="h1" display="inline-block" sx={{ fontWeight: 'bold' }}>{roomId}</Typography>
                <Tooltip title="Copiar ID de la sala">
                    <IconButton onClick={() => { navigator.clipboard.writeText(roomId); setNotification({ open: true, message: 'ID de la sala copiado' }); }}>
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
