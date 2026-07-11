import { useEffect, useRef, useState } from 'react';
import { ref, onValue, set, runTransaction, serverTimestamp } from 'firebase/database';
import { db } from '../firebase';
import { GLOBAL_VOTE_COOLDOWN, MIN_USERS_FOR_VOTE, USER_VOTE_COOLDOWN, VOTE_DURATION } from '../constants';
import { countActiveUsers } from '../utils/rooms';

/**
 * Owns the expulsion-vote lifecycle: starting/casting/ending a vote, the
 * anonymous real-time tally in Firebase, and both cooldowns. The 5 minute
 * global cooldown is validated against `serverTimestamp()` (Google's server
 * clock via `now`/`serverNow`, synced by useServerTime) so it can't be
 * bypassed by a client with a skewed local clock.
 */
export function useVoteSystem({ roomId, myPeerId, users, now, serverNow, notify }) {
    const [vote, setVote] = useState(null);
    const [lastGlobalVoteTime, setLastGlobalVoteTime] = useState(0);
    const [userCooldownRemaining, setUserCooldownRemaining] = useState(0);

    const userCooldownTimer = useRef(null);
    const prevUserCount = useRef(0);

    // --- VOTE SUBSCRIPTION ---

    useEffect(() => {
        setVote(null);
        const voteRef = ref(db, `rooms/${roomId}/vote`);
        const unsubscribe = onValue(voteRef, (snapshot) => {
            const currentVote = snapshot.val();
            setVote((prevVote) => {
                if (currentVote && !prevVote) {
                    notify('¡La votación ha comenzado!');
                }
                return currentVote;
            });
        });
        return () => unsubscribe();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [roomId]);

    useEffect(() => {
        const lastVoteRef = ref(db, `rooms/${roomId}/lastGlobalVoteTime`);
        const unsubscribe = onValue(lastVoteRef, (snapshot) => setLastGlobalVoteTime(snapshot.val() || 0));
        return () => unsubscribe();
    }, [roomId]);

    // --- AUTO-END WHEN THE 20s WINDOW CLOSES ---

    useEffect(() => {
        if (vote?.endTime && now >= vote.endTime) {
            handleEndVote();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [now, vote]);

    // --- RE-ENABLE "INICIAR VOTACIÓN" WHEN A NEW USER JOINS ---

    useEffect(() => {
        const currentUserCount = Object.keys(users).length;
        if (currentUserCount > prevUserCount.current && users[myPeerId]) {
            runTransaction(ref(db, `rooms/${roomId}/users/${myPeerId}`), (user) => {
                if (user) user.hasInitiatedVote = false;
                return user;
            });
        }
        prevUserCount.current = currentUserCount;
    }, [users, myPeerId, roomId]);

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

    useEffect(() => () => {
        if (userCooldownTimer.current) clearInterval(userCooldownTimer.current);
    }, []);

    // --- ACTIONS ---

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
            notify('Ya has emitido tu voto en esta ronda.');
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
            notify(
                outcome.kicked
                    ? `${outcome.username || 'Un usuario'} ha sido expulsado.`
                    : 'La votación ha terminado sin un resultado decisivo.'
            );
        });
    };

    return {
        vote,
        lastGlobalVoteTime,
        userCooldownRemaining,
        handleStartVote,
        handleCastVote,
    };
}
