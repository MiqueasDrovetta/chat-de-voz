import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Container, 
    Typography, 
    Box, 
    TextField, 
    Button, 
    Paper
} from '@mui/material';

function Home() {
  const [username, setUsername] = useState('');
  const navigate = useNavigate();

  const handleJoin = () => {
    if (username.trim()) {
      const randomChars = Math.random().toString(36).substring(2, 6);
      const guestUsername = `${username.trim().toLowerCase().replace(/\s+/g, '-')}`;
      const roomId = `${guestUsername}-${randomChars}`;
      navigate(`/room/${roomId}`);
    }
  };

  return (
    <Container maxWidth="sm">
      <Box 
        sx={{ 
            display: 'flex', 
            flexDirection: 'column', 
            alignItems: 'center', 
            justifyContent: 'center',
            minHeight: '100vh'
        }}
      >
        <Paper elevation={3} sx={{ p: 4, width: '100%' }}>
            <Typography component="h1" variant="h4" align="center" gutterBottom>
                Bienvenido a Chat de Voz
            </Typography>
            <Typography align="center" paragraph>
                Crea o únete a una sala para hablar con tus amigos.
            </Typography>
            <Box component="form" onSubmit={(e) => { e.preventDefault(); handleJoin(); }} sx={{ mt: 3 }}>
              <TextField
                margin="normal"
                required
                fullWidth
                id="username"
                label="Introduce tu nombre"
                name="username"
                autoFocus
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
              <Button
                type="submit"
                fullWidth
                variant="contained"
                size="large"
                sx={{ mt: 2, mb: 2 }}
              >
                Unirse a la sala
              </Button>
            </Box>
        </Paper>
      </Box>
    </Container>
  );
}

export default Home;
