import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { 
    Container, 
    Typography, 
    Box, 
    Grid, 
    Card, 
    CardContent, 
    Avatar, 
    IconButton 
} from '@mui/material';
import { Mic, MicOff } from '@mui/icons-material';
import Peer from 'peerjs';
import { db } from '../firebase';
import { ref, onValue, onDisconnect, set, remove } from 'firebase/database';

function Room() {
  const { roomId } = useParams();
  const [peer, setPeer] = useState(null);
  const [myPeerId, setMyPeerId] = useState('');
  const [users, setUsers] = useState({});
  const [audioStreams, setAudioStreams] = useState({});
  const [isMuted, setIsMuted] = useState(false);
  const myAudioRef = useRef(null);
  const connections = useRef({});

  useEffect(() => {
    const username = roomId.split('-')[0];
    const newPeer = new Peer();
    setPeer(newPeer);

    newPeer.on('open', (id) => {
      setMyPeerId(id);
      const userRef = ref(db, `rooms/${roomId}/users/${id}`);
      set(userRef, { username, isMuted: false });
      onDisconnect(userRef).remove();
    });

    navigator.mediaDevices.getUserMedia({ video: false, audio: true })
      .then(stream => {
        myAudioRef.current.srcObject = stream;
        myAudioRef.current.play();

        newPeer.on('call', call => {
          call.answer(stream);
          call.on('stream', remoteStream => {
            setAudioStreams(prev => ({...prev, [call.peer]: remoteStream }));
          });
          connections.current[call.peer] = call;
        });

      }).catch(err => console.error('Failed to get local stream', err));

    return () => {
      if (myPeerId) {
        const userRef = ref(db, `rooms/${roomId}/users/${myPeerId}`);
        remove(userRef);
      }
      newPeer.destroy();
    }
  }, [roomId]);

  useEffect(() => {
    if (!myPeerId || !peer) return;

    const roomUsersRef = ref(db, `rooms/${roomId}/users`);
    const unsubscribe = onValue(roomUsersRef, (snapshot) => {
      const allUsers = snapshot.val() || {};
      setUsers(allUsers);

      const myStream = myAudioRef.current.srcObject;
      if (myStream) {
        Object.keys(allUsers).forEach(peerId => {
          if (peerId !== myPeerId && !connections.current[peerId]) {
            const call = peer.call(peerId, myStream);
            call.on('stream', remoteStream => {
              setAudioStreams(prev => ({...prev, [peerId]: remoteStream }));
            });
            connections.current[peerId] = call;
          }
        });
      }

      Object.keys(audioStreams).forEach(peerId => {
        if (!allUsers[peerId]) {
          setAudioStreams(prev => {
            const newStreams = {...prev};
            delete newStreams[peerId];
            return newStreams;
          });
        }
      });
    });

    return () => unsubscribe();
  }, [myPeerId, peer]);

  const toggleMute = () => {
    const myStream = myAudioRef.current.srcObject;
    if (myStream) {
        myStream.getAudioTracks().forEach(track => track.enabled = !track.enabled);
        setIsMuted(!isMuted);
        const userRef = ref(db, `rooms/${roomId}/users/${myPeerId}`);
        set(userRef, { username: users[myPeerId].username, isMuted: !isMuted });
    }
  };

  return (
    <Container>
      <Typography variant="h4" gutterBottom align="center" sx={{ mt: 4 }}>
        Sala: {roomId.split('-')[0]}
      </Typography>
      <Grid container spacing={2} justifyContent="center">
          {Object.entries(users).map(([id, user]) => (
              <Grid item xs={12} sm={6} md={4} key={id}>
                  <Card raised sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', p: 2 }}>
                      <Avatar sx={{ width: 80, height: 80, mb: 2, bgcolor: 'primary.main' }}>{user.username.charAt(0)}</Avatar>
                      <CardContent sx={{ textAlign: 'center' }}>
                          <Typography variant="h6">{user.username}</Typography>
                          {id === myPeerId ? (
                            <IconButton onClick={toggleMute} color="primary">
                                {isMuted ? <MicOff /> : <Mic />}
                            </IconButton>
                          ) : (
                            <IconButton color="primary" disabled>
                                {user.isMuted ? <MicOff /> : <Mic />}
                            </IconButton>
                          )}
                      </CardContent>
                  </Card>
              </Grid>
          ))}
      </Grid>
      <audio ref={myAudioRef} muted />
      {Object.entries(audioStreams).map(([peerId, stream]) => (
        <audio key={peerId} autoPlay ref={el => { if (el) el.srcObject = stream; }} />
      ))}
    </Container>
  );
}

export default Room;
