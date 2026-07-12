
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../firebase';
import { Box, TextField, Button, Typography, Container, Card } from '@mui/material';
import { motion, useMotionValue, useTransform, animate } from 'framer-motion';
import { styled } from '@mui/system';
import { findAvailableRoom, createRoom } from '../utils/rooms';

// --- Styled Components & Custom Hooks ---

const MotionBox = motion(Box);
const MotionButton = motion(Button);

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

// Estilo compartido por los dos botones de acción (mismo look "pill" con glow
// que ya tenía el botón original, ahora sobre variantes reales de MUI en vez
// de un <button> a medida, para poder diferenciar contained/outlined).
const actionButtonSx = {
    flex: 1,
    py: 1.5,
    fontSize: '1rem',
    fontWeight: 'bold',
    borderRadius: '50px',
    textTransform: 'none',
};

const primaryActionSx = {
    ...actionButtonSx,
    boxShadow: '0 0 12px 2px rgba(144, 202, 249, 0.45)',
    '&:hover': { boxShadow: '0 0 20px 6px rgba(144, 202, 249, 0.65)' },
};

const secondaryActionSx = {
    ...actionButtonSx,
    borderColor: 'rgba(144, 202, 249, 0.5)',
    borderWidth: 2,
    color: '#90caf9',
    '&:hover': { borderWidth: 2, borderColor: '#90caf9', backgroundColor: 'rgba(144, 202, 249, 0.08)' },
};

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

// Firebase Realtime Database rechaza estos caracteres en una clave/segmento de ruta.
const FORBIDDEN_ROOM_ID_CHARS = /[.#$[\]/]/;

// ...y también rechaza caracteres de control; se chequean por código en vez de
// en el regex de arriba para no meter bytes de control dentro de un literal.
function hasControlChar(str) {
    for (let i = 0; i < str.length; i++) {
        const code = str.charCodeAt(i);
        if (code <= 0x1f || code === 0x7f) return true;
    }
    return false;
}

// --- Component ---

function Home() {
    const [baseUsername, setBaseUsername] = useState('');
    const [roomIdInput, setRoomIdInput] = useState('');
    const [roomIdError, setRoomIdError] = useState('');
    const navigate = useNavigate();
    const { x, y } = useMouseFollow();

    // Gradiente del fondo que sigue al mouse
    const backgroundGradient = useTransform(
        [x, y],
        ([px, py]) => `radial-gradient(600px at ${px}px ${py}px, rgba(29, 53, 87, 0.4), transparent 80%)`
    );

    const handleJoin = async () => {
        if (!baseUsername.trim()) return;

        const requestedRoomId = roomIdInput.trim();
        if (requestedRoomId && (FORBIDDEN_ROOM_ID_CHARS.test(requestedRoomId) || hasControlChar(requestedRoomId))) {
            setRoomIdError('No puede contener . # $ [ ] / ni caracteres de control');
            return;
        }
        setRoomIdError('');

        const finalUsername = `${baseUsername.trim()}-${Math.random().toString(36).substring(2, 6)}`;

        try {
            if (requestedRoomId) {
                navigate(`/${encodeURIComponent(requestedRoomId)}?username=${encodeURIComponent(finalUsername)}`);
                return;
            }

            const availableRoomId = await findAvailableRoom(db);

            if (availableRoomId) {
                navigate(`/${availableRoomId}?username=${encodeURIComponent(finalUsername)}`);
            } else {
                const newRoomId = await createRoom(db);
                navigate(`/${newRoomId}?username=${encodeURIComponent(finalUsername)}`);
            }
        } catch (error) {
            console.error("Error al unirse a la sala:", error);
        }
    };

    // "Crear Nueva Sala" siempre arma una sala propia desde cero: nunca busca
    // una sala automática ni mira el campo "ID de la Sala" (ese campo es sólo
    // para el flujo de "Unirse a la Sala").
    const handleCreateRoom = async () => {
        if (!baseUsername.trim()) return;

        const finalUsername = `${baseUsername.trim()}-${Math.random().toString(36).substring(2, 6)}`;

        try {
            const newRoomId = await createRoom(db);
            navigate(`/${newRoomId}?username=${encodeURIComponent(finalUsername)}`);
        } catch (error) {
            console.error('Error creando la sala:', error);
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
                    <Card
                        elevation={0}
                        sx={{
                            p: 4,
                            borderRadius: 4,
                            backgroundColor: 'rgba(30, 30, 30, 0.45)',
                            backdropFilter: 'blur(12px)',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.35)',
                        }}
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
                            <AnimatedTextField
                                label="ID de la Sala (Opcional)"
                                variant="outlined"
                                value={roomIdInput}
                                onChange={(e) => { setRoomIdInput(e.target.value); setRoomIdError(''); }}
                                onKeyPress={(e) => e.key === 'Enter' && handleJoin()}
                                error={!!roomIdError}
                                helperText={roomIdError || 'Dejalo vacío para unirte a una sala automática'}
                                InputLabelProps={{ style: { color: 'rgba(255, 255, 255, 0.7)' } }}
                                inputProps={{ style: { color: '#fff' } }}
                                FormHelperTextProps={{ sx: { color: roomIdError ? undefined : 'rgba(255, 255, 255, 0.5)' } }}
                            />
                            <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 2 }}>
                                <MotionButton
                                    variant="contained"
                                    onClick={handleJoin}
                                    whileHover={{ scale: 1.05 }}
                                    whileTap={{ scale: 0.95 }}
                                    sx={primaryActionSx}
                                >
                                    Unirse a la Sala
                                </MotionButton>
                                <MotionButton
                                    variant="outlined"
                                    onClick={handleCreateRoom}
                                    whileHover={{ scale: 1.05 }}
                                    whileTap={{ scale: 0.95 }}
                                    sx={secondaryActionSx}
                                >
                                    Crear Nueva Sala
                                </MotionButton>
                            </Box>
                        </Box>
                    </Card>
                </motion.div>
            </Container>
        </MotionBox>
    );
}

export default Home;
