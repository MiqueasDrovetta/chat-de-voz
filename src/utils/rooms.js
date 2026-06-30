import { ref, get, push, set } from 'firebase/database';
import { MAX_USERS_PER_ROOM } from '../constants';

export const isActiveUser = (user) => !!user && user.status !== 'disconnected';

export const countActiveUsers = (users) =>
    Object.values(users || {}).filter(isActiveUser).length;

export async function findAvailableRoom(db) {
    const roomsRef = ref(db, 'rooms');
    const snapshot = await get(roomsRef);
    const rooms = snapshot.val() || {};

    for (const [id, room] of Object.entries(rooms)) {
        if (countActiveUsers(room.users) < MAX_USERS_PER_ROOM) {
            return id;
        }
    }
    return null;
}

export async function createRoom(db) {
    const roomsRef = ref(db, 'rooms');
    const newRoomRef = push(roomsRef);
    await set(newRoomRef, { users: {}, lastGlobalVoteTime: 0 });
    return newRoomRef.key;
}
