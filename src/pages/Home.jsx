
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../firebase';
import { ref, get, child, push, set } from 'firebase/database';
import { Box, TextField, Button, Typography, Container } from '@mui/material';
import { motion, useMotionValue, useTransform, animate } from 'framer-motion';
import { styled } from '@mui/system';

// --- Styled Components & Custom Hooks ---

const MotionBox = motion(Box);

const useMouseFollow = () => {
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  useEffect(() => {
    const handleMouseMove = (e) => {
      animate(x, e.clientX);
      animate(y, e.clientY);
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, [x, y]);

  return { x, y };
};

const GlowButton = styled(motion.button)(({ theme }) => ({
  padding: '12px 24px',
  fontSize: '1.1rem',
  fontWeight: 'bold',
  color: '#fff',
  backgroundColor: 'transparent',
  border: '2px solid #90caf9',
  borderRadius: '50px',
  cursor: 'pointer',
  position: 'relative',
  overflow: 'hidden',
  transition: 'color 0.4s, box-shadow 0.4s',
  '--glow-color': 'rgba(144, 202, 249, 0.8)',
  '--glow-spread': '0px',

  '&:before': {
    content: '""',
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#90caf9',
    borderRadius: '50px',
    transform: 'scaleX(0)',
    transformOrigin: 'left',
    transition: 'transform 0.4s ease',
    zIndex: -1,
  },

  '&:hover': {
    color: '#121212',
    '--glow-spread': '8px',
    boxShadow: `0 0 15px 5px var(--glow-color)`,
  },

  '&:hover:before': {
    transform: 'scaleX(1)',
  },
}));

const AnimatedTextField = styled(TextField)({
  '& label.Mui-focused': {
    color: '#90caf9',
  },
  '& .MuiOutlinedInput-root': {
    transition: 'box-shadow 0.3s ease-in-out',
    '& fieldset': {
      borderColor: 'rgba(255, 255, 255, 0.3)',
    },
    '&:hover fieldset': {
      borderColor: '#90caf9',
    },
    '&.Mui-focused fieldset': {
      borderColor: '#90caf9',
    },
    '&.Mui-focused': {
      boxShadow: '0 0 10px 2px rgba(144, 202, 249, 0.5)',
    },
  },
});

// --- Component --- 

function Home() {
    const [baseUsername, setBaseUsername] = useState('');
    const navigate = useNavigate();
    const { x, y } = useMouseFollow();
    
    // Gradiente del fondo que sigue al mouse
    const backgroundGradient = useTransform(
        [x, y],
        ([px, py]) => `radial-gradient(600px at ${px}px ${py}px, rgba(29, 53, 87, 0.4), transparent 80%)`
    );

    const handleJoin = async () => {
        if (!baseUsername.trim()) return;
        const finalUsername = `${baseUsername.trim()}-${Math.random().toString(36).substring(2, 6)}`;

        try {
            const roomsRef = ref(db, 'rooms');
            const snapshot = await get(roomsRef);
            const rooms = snapshot.val() || {};
            let availableRoomId = null;

            for (const [id, room] of Object.entries(rooms)) {
                if (Object.keys(room.users || {}).length < 5) { // Changed limit to 5
                    availableRoomId = id;
                    break;
                }
            }

            if (availableRoomId) {
                navigate(`/chat-de-voz/${availableRoomId}?username=${finalUsername}`);
            } else {
                const newRoomRef = push(roomsRef);
                set(newRoomRef, { users: {}, lastGlobalVoteTime: 0 });
                navigate(`/chat-de-voz/${newRoomRef.key}?username=${finalUsername}`);
            }
        } catch (error) {
            console.error("Error al unirse a la sala:", error);
        }
    };

    return (
        <MotionBox
            style={{ background: backgroundGradient }}
            sx={{
                width: '100vw',
                height: '100vh',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                position: 'relative',
            }}
        >
            <Container maxWidth="sm" sx={{ textAlign: 'center', zIndex: 1 }}>
                <motion.div
                    initial={{ opacity: 0, y: -50 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.8, ease: "easeOut" }}
                >
                    <Typography variant="h2" component="h1" sx={{
                        fontWeight: 700,
                        mb: 1,
                        background: 'linear-gradient(45deg, #90caf9 30%, #f48fb1 90%)',
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                        textShadow: `
                            0 0 8px rgba(144, 202, 249, 0.6),
                            0 0 16px rgba(144, 202, 249, 0.5),
                            0 0 24px rgba(244, 143, 177, 0.4),
                            0 0 32px rgba(244, 143, 177, 0.3)
                        `,
                    }}>
                        Bienvenido al Chat de Voz
                    </Typography>
                </motion.div>

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.8, delay: 0.3, ease: "easeOut" }}
                >
                    <Typography variant="h6" sx={{ color: 'rgba(255, 255, 255, 0.7)', mb: 4 }}>
                        Ingresa tu nombre para unirte o crear una sala de chat.
                    </Typography>
                </motion.div>

                <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.6, delay: 0.6 }}
                >
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <AnimatedTextField
                            label="Tu nombre de usuario"
                            variant="outlined"
                            value={baseUsername}
                            onChange={(e) => setBaseUsername(e.target.value)}
                            onKeyPress={(e) => e.key === 'Enter' && handleJoin()}
                            InputLabelProps={{ style: { color: 'rgba(255, 255, 255, 0.7)' } }}
                            inputProps={{ style: { color: '#fff' } }}
                        />
                        <GlowButton 
                            onClick={handleJoin}
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                        >
                            Unirse a la Sala
                        </GlowButton>
                    </Box>
                </motion.div>
            </Container>
        </MotionBox>
    );
}

export default Home;
