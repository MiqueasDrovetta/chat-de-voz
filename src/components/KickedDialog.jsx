import React from 'react';
import { Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, Button } from '@mui/material';

function KickedDialog({ open, stage, isSearching, onSearchRoom, onCreateRoom, onGoHome }) {
    const isNoRooms = stage === 'noRoomsAvailable';

    return (
        <Dialog open={open} disableEscapeKeyDown onClose={() => {}}>
            <DialogTitle>{isNoRooms ? 'Sin salas disponibles' : 'Has sido expulsado'}</DialogTitle>
            <DialogContent>
                <DialogContentText>
                    {isNoRooms
                        ? 'No se encontraron salas disponibles.'
                        : 'Has sido expulsado de la sala. ¿Qué deseas hacer?'}
                </DialogContentText>
            </DialogContent>
            <DialogActions>
                {isNoRooms ? (
                    <>
                        <Button variant="contained" onClick={onCreateRoom}>Crear nueva sala</Button>
                        <Button variant="outlined" onClick={onGoHome}>Ir al Inicio</Button>
                    </>
                ) : (
                    <>
                        <Button variant="contained" onClick={onSearchRoom} disabled={isSearching}>
                            {isSearching ? 'Buscando...' : 'Buscar otra sala'}
                        </Button>
                        <Button variant="outlined" onClick={onGoHome}>Ir al Inicio</Button>
                    </>
                )}
            </DialogActions>
        </Dialog>
    );
}

export default KickedDialog;
