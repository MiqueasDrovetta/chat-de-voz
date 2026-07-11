import { useEffect, useRef, useState } from 'react';
import { ref, onValue } from 'firebase/database';
import { db } from '../firebase';

/**
 * Syncs local clock against Firebase's server clock offset so cooldowns and
 * vote timers can never be gamed by a client with a wrong/adjusted local clock.
 */
export function useServerTime() {
    const serverOffsetRef = useRef(0);
    const [now, setNow] = useState(0);

    useEffect(() => {
        const offsetNodeRef = ref(db, '.info/serverTimeOffset');
        const unsubscribe = onValue(offsetNodeRef, (snapshot) => {
            serverOffsetRef.current = snapshot.val() || 0;
        });
        return () => unsubscribe();
    }, []);

    useEffect(() => {
        setNow(Date.now() + serverOffsetRef.current);
        const id = setInterval(() => setNow(Date.now() + serverOffsetRef.current), 1000);
        return () => clearInterval(id);
    }, []);

    const serverNow = () => Date.now() + serverOffsetRef.current;

    return { now, serverNow };
}
