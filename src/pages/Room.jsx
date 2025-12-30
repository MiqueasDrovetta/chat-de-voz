import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
    Container,
    Typography,
    Box,
    Grid,
    Card,
    CardContent,
    Avatar,
    IconButton,
    Tooltip,
    Snackbar,
    Button,
    LinearProgress,
    Chip
} from '@mui/material';
import { Mic, MicOff, ContentCopy, HowToVote, CheckCircle } from '@mui/icons-material';
import Peer from 'peerjs';
import { db } from '../firebase';
import { ref, onValue, onDisconnect, set, remove, runTransaction, get } from 'firebase/database';

const MAX_USERS = 5;
const VOTE_DURATION = 20; // seconds
const USER_VOTE_COOLDOWN = 120; // seconds
const GLOBAL_VOTE_COOLDOWN = 300; // seconds

function Room() {
    const { roomId } = useParams();
    const navigate = useNavigate();
    const location = useLocation();
    const [username, setUsername] = useState('');
    const [peer, setPeer] = useState(null);
    const [myPeerId, setMyPeerId] = useState('');
    const [users, setUsers] = useState({});
    const [audioStreams, setAudioStreams] = useState({});
    const [isMuted, setIsMuted] = useState(false);
    const [notification, setNotification] = useState({ open: false, message: '' });
    const [vote, setVote] = useState(null); // { initiator, endTime, votes: { targetId: { voterId: true } } }
    const [userCooldownTime, setUserCooldownTime] = useState(0);
    
    const myAudioRef = useRef(null);
    const connections = useRef({});
    const voteTimer = useRef(null);
    const userCooldownTimer = useRef(null);
    const prevUserCount = useRef(0);

    // --- EFFECTS ---

    useEffect(() => {
        const queryParams = new URLSearchParams(location.search);
        const userParam = queryParams.get('username');
        if (!userParam) { navigate('/'); return; }
        setUsername(userParam);

        initializeRoom(userParam);

        return () => {
            if (myPeerId) remove(ref(db, `rooms/${roomId}/users/${myPeerId}`));
            if (peer) peer.destroy();
            if (voteTimer.current) clearInterval(voteTimer.current);
            if (userCooldownTimer.current) clearTimeout(userCooldownTimer.current);
        };
    }, [roomId, navigate, location.search]);

    useEffect(() => {
        if (!myPeerId || !peer) return;

        const roomUsersRef = ref(db, `rooms/${roomId}/users`);
        const unsubscribe = onValue(roomUsersRef, (snapshot) => {
            const allUsers = snapshot.val() || {};
            setUsers(allUsers);
            
            const currentUserCount = Object.keys(allUsers).length;
            if (currentUserCount > prevUserCount.current) {
                // A new user has joined, reset vote initiation rights
                if(allUsers[myPeerId]) {
                    runTransaction(ref(db, `rooms/${roomId}/users/${myPeerId}`), (user) => {
                        if(user) user.hasInitiatedVote = false;
                        return user;
                    });
                }
            }
            prevUserCount.current = currentUserCount;

            handleWebRTCConnections(allUsers);
        });
        return () => unsubscribe();
    }, [myPeerId, peer, roomId]);

    useEffect(() => {
        const voteRef = ref(db, `rooms/${roomId}/vote`);
        const unsubscribe = onValue(voteRef, (snapshot) => {
            const currentVote = snapshot.val();
            if (currentVote && !vote) {
                setNotification({ open: true, message: `¡La votación ha comenzado!` });
            }
            setVote(currentVote);

            if (currentVote && currentVote.endTime && !voteTimer.current) {
                voteTimer.current = setInterval(() => {
                   const now = Date.now();
                   if (now > currentVote.endTime) {
                       handleEndVote();
                   }
                }, 1000);
            } else if (!currentVote && voteTimer.current) {
                clearInterval(voteTimer.current);
                voteTimer.current = null;
            }
        });
        return () => {
            unsubscribe();
            if (voteTimer.current) clearInterval(voteTimer.current);
        };
    }, [roomId, vote]);
    
    // --- INITIALIZATION & WebRTC ---

    const initializeRoom = (userParam) => {
        get(ref(db, `rooms/${roomId}/users`)).then((snapshot) => {
            if (Object.keys(snapshot.val() || {}).length >= MAX_USERS) {
                alert('La sala de chat está llena.');
                navigate('/');
                return;
            }

            const newPeer = new Peer();
            setPeer(newPeer);

            newPeer.on('open', (id) => {
                setMyPeerId(id);
                const userRef = ref(db, `rooms/${roomId}/users/${id}`);
                get(ref(db, `rooms/${roomId}/nominations/${id}`)).then((nomSnapshot) => {
                    set(userRef, { username: userParam, isMuted: false, nominations: nomSnapshot.val() || 0, hasInitiatedVote: false });
                });
                onDisconnect(userRef).remove();

                navigator.mediaDevices.getUserMedia({ audio: true, video: false })
                    .then(stream => {
                        if (myAudioRef.current) {
                            myAudioRef.current.srcObject = stream;
                        }
                        newPeer.on('call', (call) => {
                            call.answer(stream);
                            call.on('stream', (remoteStream) => {
                                setAudioStreams(prev => ({ ...prev, [call.peer]: remoteStream }));
                            });
                            connections.current[call.peer] = call;
                        });
                         // Now that we have the stream, connect to other users
                        const roomUsersRef = ref(db, `rooms/${roomId}/users`);
                        get(roomUsersRef).then(snapshot => handleWebRTCConnections(snapshot.val() || {}, stream));

                    }).catch(err => {
                        console.error("Failed to get media", err);
                        alert('No se pudo acceder al micrófono.');
                    });
            });
        });
    };

    const handleWebRTCConnections = (allUsers, myStream) => {
        if (!myStream) {
            myStream = myAudioRef.current?.srcObject;
        }
        if (!myStream) return; // Can't connect without a stream
        
        Object.keys(allUsers).forEach(peerId => {
            if (peerId !== myPeerId && !connections.current[peerId]) {
                console.log(`Calling peer: ${peerId}`);
                const call = peer.call(peerId, myStream);
                if (call) {
                    call.on('stream', remoteStream => {
                        console.log(`Receiving stream from: ${peerId}`);
                        setAudioStreams(prev => ({ ...prev, [peerId]: remoteStream }));
                    });
                    call.on('close', () => {
                        console.log(`Connection closed with: ${peerId}`);
                         setAudioStreams(prev => {
                            const newStreams = { ...prev };
                            delete newStreams[peerId];
                            return newStreams;
                        });
                    });
                    connections.current[peerId] = call;
                }
            }
        });

        Object.keys(connections.current).forEach(peerId => {
            if (!allUsers[peerId]) {
                console.log(`Closing connection with disconnected peer: ${peerId}`);
                connections.current[peerId]?.close();
                delete connections.current[peerId];
                setAudioStreams(prev => {
                    const newStreams = { ...prev };
                    delete newStreams[peerId];
                    return newStreams;
                });
            }
        });
    };


    // --- VOTING LOGIC ---

    const handleStartVote = async () => {
        const now = Date.now();
        const roomSnapshot = await get(ref(db, `rooms/${roomId}`));
        const roomData = roomSnapshot.val();

        if (now - (roomData.lastGlobalVoteTime || 0) < GLOBAL_VOTE_COOLDOWN * 1000) {
            setNotification({ open: true, message: `La sala está en cooldown. Espera ${Math.ceil((roomData.lastGlobalVoteTime + GLOBAL_VOTE_COOLDOWN * 1000 - now) / 1000)}s.` });
            return;
        }

        runTransaction(ref(db, `rooms/${roomId}/users/${myPeerId}`), (user) => {
            if (user && !user.hasInitiatedVote) {
                user.hasInitiatedVote = true;
            } else {
                // Abort transaction
                return;
            }
            return user;
        }).then(({ committed }) => {
            if (committed) {
                set(ref(db, `rooms/${roomId}/vote`), { initiator: myPeerId, endTime: now + VOTE_DURATION * 1000, votes: {} });
                set(ref(db, `rooms/${roomId}/lastGlobalVoteTime`), now);
            }
        });
    };

    const handleCastVote = (targetId) => {
        if (!vote || vote.initiator === targetId || myPeerId === targetId) return;
        // Check if user has already voted for anyone
        const alreadyVoted = Object.values(vote.votes || {}).some(voteData => voteData[myPeerId]);
        if (alreadyVoted) {
            setNotification({open: true, message: "Ya has emitido tu voto en esta ronda."});
            return;
        }
        set(ref(db, `rooms/${roomId}/vote/votes/${targetId}/${myPeerId}`), true);
    };
    
    const handleEndVote = () => {
         runTransaction(ref(db, `rooms/${roomId}`), (room) => {
            if (!room || !room.vote) return room;

            const currentVote = room.vote;
            const usersInRoom = room.users || {};
            const userCount = Object.keys(usersInRoom).length;
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

            if (userToKick && maxVotes > userCount / 2) {
                setNotification({ open: true, message: `${usersInRoom[userToKick]?.username || 'Un usuario'} ha sido expulsado.` });
                if (usersInRoom[userToKick]) {
                    room.nominations = room.nominations || {};
                    room.nominations[userToKick] = (room.nominations[userToKick] || 0) + 1;
                    room.users[userToKick] = null; // Mark for deletion
                }
            } else {
                setNotification({ open: true, message: "La votación ha terminado sin un resultado decisivo." });
            }
            
            room.vote = null; // End vote
            return room;
        });
        if (vote?.target === myPeerId && maxVotes > Object.keys(users).length / 2) {
            alert('Has sido expulsado de la sala.');
            navigate('/');
        }
    };

    const toggleMute = () => {
        const myStream = myAudioRef.current?.srcObject;
        if (myStream?.getAudioTracks().length > 0) {
            const isCurrentlyMuted = !myStream.getAudioTracks()[0].enabled;
            myStream.getAudioTracks()[0].enabled = isCurrentlyMuted;
            setIsMuted(!isCurrentlyMuted);
            runTransaction(ref(db, `rooms/${roomId}/users/${myPeerId}`), (user) => {
                if(user) user.isMuted = !isCurrentlyMuted;
                return user;
            });
        }
    };

    // --- RENDER ---

    const renderVoteButton = (targetId, targetUsername) => {
        if (!vote || vote.initiator === targetId || myPeerId === targetId) return null;
        const hasVotedForThisUser = vote.votes?.[targetId]?.[myPeerId];
        const alreadyVotedInRound = Object.values(vote.votes || {}).some(voters => voters[myPeerId]);

        return (
            <Tooltip title={alreadyVotedInRound ? (hasVotedForThisUser ? "Tu voto" : "Ya votaste") : `Votar para expulsar a ${targetUsername}`}>
                <span>
                    <IconButton onClick={() => handleCastVote(targetId)} disabled={alreadyVotedInRound}>
                        {hasVotedForThisUser ? <CheckCircle color="success"/> : <HowToVote />}
                    </IconButton>
                </span>
            </Tooltip>
        );
    };

    return (
        <Container>
            <Box sx={{ my: 4, textAlign: 'center' }}>
                <Typography variant="h4" component="h1" display="inline-block">Sala: </Typography>
                <Typography variant="h4" component="h1" display="inline-block" sx={{ fontWeight: 'bold' }}>{roomId}</Typography>
                <Tooltip title="Copiar ID de la sala">
                    <IconButton onClick={() => { navigator.clipboard.writeText(roomId); setNotification({ open: true, message: 'ID de la sala copiado' });}}><ContentCopy /></IconButton>
                </Tooltip>
            </Box>
            <Typography align="center" paragraph> {Object.keys(users).length} de {MAX_USERS} participantes.</Typography>

            {vote && (
                <Box sx={{ my: 2, p: 2, border: '1px solid grey', borderRadius: 2 }}>
                    <Typography align="center" gutterBottom>Votación en curso</Typography>
                    <LinearProgress variant="determinate" value={((vote.endTime - Date.now()) / (VOTE_DURATION * 1000)) * 100} sx={{mb: 1}}/>
                    <Typography align="center">Tiempo restante: {Math.max(0, Math.ceil((vote.endTime - Date.now()) / 1000))}s</Typography>
                </Box>
            )}

            <Grid container spacing={3} justifyContent="center">
                {Object.entries(users).map(([id, user]) => (
                    <Grid item xs={12} sm={6} md={4} lg={3} key={id}>
                        <Card raised sx={{ p: 2, position: 'relative', textAlign: 'center' }}>
                            {id === myPeerId && <Typography sx={{ position: 'absolute', top: 8, right: 8, color: 'primary.main', fontWeight: 'bold' }}>Tú</Typography>}
                            <Avatar sx={{ width: 80, height: 80, mb: 1, mx: 'auto', bgcolor: 'secondary.main' }}>{user.username.charAt(0).toUpperCase()}</Avatar>
                            <CardContent sx={{p: 0}}>
                                <Typography variant="h6">{user.username}</Typography>
                                <Typography variant="caption">Nominaciones: {user.nominations || 0}</Typography>
                                {vote?.votes?.[id] && <Chip label={`Votos: ${Object.keys(vote.votes[id]).length}`} size="small" sx={{mt: 1}}/>}
                                <Box>
                                    <IconButton color="primary" disabled={id !== myPeerId} onClick={toggleMute}>{(id === myPeerId ? isMuted : user.isMuted) ? <MicOff /> : <Mic />}</IconButton>
                                    {renderVoteButton(id, user.username)}
                                </Box>
                            </CardContent>
                        </Card>
                    </Grid>
                ))}
            </Grid>
            
            {!vote && (
                 <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
                    <Tooltip title={users[myPeerId]?.hasInitiatedVote ? "Ya has iniciado una votación en esta sesión" : "Iniciar una votación para expulsar a un miembro"}>
                        <span>
                        <Button 
                            variant="contained" 
                            onClick={handleStartVote} 
                            disabled={vote || users[myPeerId]?.hasInitiatedVote || Object.keys(users).length < 2}
                        >
                            Iniciar Votación
                        </Button>
                        </span>
                    </Tooltip>
                 </Box>
            )}

            <audio ref={myAudioRef} muted autoPlay playsInline />
            {Object.entries(audioStreams).map(([peerId, stream]) => (
                <audio key={peerId} autoPlay playsInline ref={el => { if (el) el.srcObject = stream; }} />
            ))}

            <Snackbar open={notification.open} autoHideDuration={4000} onClose={() => setNotification({ ...notification, open: false })} message={notification.message} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}/>
        </Container>
    );
}

export default Room;
