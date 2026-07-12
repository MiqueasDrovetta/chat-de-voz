import { useEffect, useRef, useState } from 'react';
import Peer from 'peerjs';
import {
    ref,
    onValue,
    onDisconnect,
    set,
    update,
    runTransaction,
    get,
    serverTimestamp,
} from 'firebase/database';
import { db } from '../firebase';
import {
    MAX_USERS_PER_ROOM,
    RECONNECT_GRACE_MS,
    HEARTBEAT_INTERVAL_MS,
    PRESENCE_STALE_MS,
} from '../constants';
import { isActiveUser, countReservedSlots } from '../utils/rooms';

/**
 * Encapsulates all PeerJS/WebRTC signaling: peer lifecycle, microphone stream,
 * P2P call wiring, presence in Firebase, the 10s reconnect-grace window for
 * microcuts, and kick detection. PeerJS instances, active calls and the local
 * MediaStream live in refs so React re-renders never tear down the audio graph.
 */
export function useWebRTCChat({ roomId, username, navigate, serverNow }) {
    const [myPeerId, setMyPeerId] = useState('');
    const [users, setUsers] = useState({});
    const [audioStreams, setAudioStreams] = useState({});
    const [isMuted, setIsMuted] = useState(false);
    const [kicked, setKicked] = useState(false);
    const [presenceReady, setPresenceReady] = useState(false);

    const myAudioRef = useRef(null);
    const peerRef = useRef(null);
    const myStreamRef = useRef(null);
    const connections = useRef({});
    const ghostTimers = useRef({});
    const prevUsersRef = useRef({});
    const storageKey = `voiceChat:${roomId}`;

    // --- WEBRTC CALL WIRING ---

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
        const idAtKick = peerRef.current?.id;
        if (idAtKick) {
            onDisconnect(ref(db, `rooms/${roomId}/users/${idAtKick}`)).cancel();
        }
        Object.values(connections.current).forEach((call) => call.close());
        connections.current = {};
        myStreamRef.current?.getTracks().forEach((track) => track.stop());
        peerRef.current?.destroy();
        peerRef.current = null;
        setAudioStreams({});
        sessionStorage.removeItem(storageKey);
        // Stops the heartbeat effect (gated on presenceReady): otherwise it would
        // keep firing every HEARTBEAT_INTERVAL_MS and recreate our just-deleted
        // node with lastSeen/status but no username, the same zombie shape the
        // presenceReady gate above exists to prevent in the first place.
        setPresenceReady(false);
        setKicked(true);
    };

    // --- ROOM/NOMINATIONS CLEANUP ---
    // Removes a user's slot from the room. When that leaves the room with zero
    // remaining users, the nomination history and vote cooldowns are wiped too,
    // per spec: history is cumulative per-session but dies with an empty room.
    const removeUserFromRoom = (id, { onlyIfDisconnected = false } = {}) => {
        runTransaction(ref(db, `rooms/${roomId}`), (room) => {
            if (!room || !room.users || !room.users[id]) return room;
            if (onlyIfDisconnected && room.users[id].status !== 'disconnected') return room;

            delete room.users[id];
            if (Object.keys(room.users).length === 0) {
                room.nominations = null;
                room.lastGlobalVoteTime = 0;
                room.vote = null;
            }
            return room;
        });
    };

    const purgeGhost = (id) => removeUserFromRoom(id, { onlyIfDisconnected: true });

    // --- INITIALIZATION ---

    useEffect(() => {
        if (!username) return;

        let cancelled = false;

        setKicked(false);
        setIsMuted(false);
        setPresenceReady(false);
        setUsers({});
        setAudioStreams({});
        prevUsersRef.current = {};
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
                sessionStorage.setItem(storageKey, JSON.stringify({ username, peerId: id }));

                const userRef = ref(db, `rooms/${roomId}/users/${id}`);
                onDisconnect(userRef).update({ status: 'disconnected', disconnectedAt: serverTimestamp() });

                get(ref(db, `rooms/${roomId}/nominations/${id}`)).then((nomSnapshot) =>
                    set(userRef, {
                        username,
                        isMuted: false,
                        nominations: nomSnapshot.val() || 0,
                        hasInitiatedVote: false,
                        status: 'connected',
                        disconnectedAt: null,
                        lastSeen: serverTimestamp(),
                    })
                ).then(() => {
                    // Sólo ahora existe el registro completo en Firebase: recién acá es
                    // seguro dejar que el heartbeat escriba sobre este nodo, para que
                    // nunca pueda ganarle la carrera al set() inicial y crear un nodo a
                    // medias (sin username) que otros clientes intenten renderizar.
                    if (!cancelled) setPresenceReady(true);
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
            let storedSession = null;
            try {
                storedSession = JSON.parse(sessionStorage.getItem(storageKey));
            } catch {
                storedSession = null;
            }
            const reconnectPeerId = storedSession?.username === username ? storedSession.peerId : null;

            const usersSnapshot = await get(ref(db, `rooms/${roomId}/users`));
            const existingUsers = usersSnapshot.val() || {};

            // Reclaiming our own still-reserved (grace-window) slot never adds a new
            // occupant, so it must bypass the capacity gate even at 9/9 reserved slots.
            const isReclaimingOwnSlot = !!reconnectPeerId && !!existingUsers[reconnectPeerId];
            if (!isReclaimingOwnSlot && countReservedSlots(existingUsers) >= MAX_USERS_PER_ROOM) {
                alert('La sala de chat está llena.');
                navigate('/');
                return;
            }
            if (cancelled) return;

            createAndConnectPeer(reconnectPeerId);
        };

        initializeRoom();

        return () => {
            cancelled = true;
            const idAtCleanup = peerRef.current?.id;
            if (idAtCleanup) {
                const userRef = ref(db, `rooms/${roomId}/users/${idAtCleanup}`);
                onDisconnect(userRef).cancel();
                removeUserFromRoom(idAtCleanup);
            }
            sessionStorage.removeItem(storageKey);
            Object.values(connections.current).forEach((call) => call.close());
            connections.current = {};
            myStreamRef.current?.getTracks().forEach((track) => track.stop());
            peerRef.current?.destroy();
            peerRef.current = null;
            Object.values(ghostTimers.current).forEach(clearTimeout);
            ghostTimers.current = {};
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [roomId, username, navigate]);

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

            const activeCount = Object.values(allUsers).filter(isActiveUser).length;
            if (activeCount >= MAX_USERS_PER_ROOM) {
                Object.entries(allUsers).forEach(([id, user]) => {
                    if (id !== myPeerId && !isActiveUser(user)) purgeGhost(id);
                });
            }

            // Presence backstop: someone can still read "connected" here while their
            // actual tab/socket is long gone, if onDisconnect never got a chance to
            // fire server-side (abrupt process kill, network partition). Any other
            // client noticing a stale heartbeat flips them to disconnected itself,
            // which then feeds the normal grace-purge below like a real onDisconnect would.
            Object.entries(allUsers).forEach(([id, user]) => {
                if (id === myPeerId || !isActiveUser(user)) return;
                if (user.lastSeen && serverNow() - user.lastSeen > PRESENCE_STALE_MS) {
                    update(ref(db, `rooms/${roomId}/users/${id}`), {
                        status: 'disconnected',
                        disconnectedAt: serverTimestamp(),
                    });
                }
            });

            Object.entries(allUsers).forEach(([id, user]) => {
                // Never schedule a self-purge: if this code is running, this client is
                // definitionally still alive, no matter what its own node currently says
                // (e.g. a stale-flag race before this tick's heartbeat self-heal lands).
                if (id === myPeerId) return;
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

    // --- PRESENCE HEARTBEAT ---
    // Keeps our own `lastSeen` fresh so other clients never need to guess whether
    // we're really still here; this is what the staleness check above reads. Each
    // beat also REASSERTS status:'connected': if a stale-but-actually-alive tab
    // (background-throttled, brief network blip) got flagged 'disconnected' by
    // someone else's staleness check, this is its only way to self-heal before
    // the grace-purge timer deletes it — with a 5s heartbeat against a 10s grace
    // window, self-heal always gets at least one chance to win that race.
    useEffect(() => {
        // presenceReady gates this on the initial set() having already created the
        // full user record — otherwise an early beat() could win a race against
        // that set() and leave a node with lastSeen/status but no username.
        if (!myPeerId || !presenceReady) return;

        const beat = () => update(ref(db, `rooms/${roomId}/users/${myPeerId}`), {
            lastSeen: serverTimestamp(),
            status: 'connected',
            disconnectedAt: null,
        });
        beat();
        const id = setInterval(beat, HEARTBEAT_INTERVAL_MS);
        return () => clearInterval(id);
    }, [myPeerId, roomId, presenceReady]);

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

    return {
        myPeerId,
        users,
        audioStreams,
        isMuted,
        kicked,
        myAudioRef,
        toggleMute,
    };
}
