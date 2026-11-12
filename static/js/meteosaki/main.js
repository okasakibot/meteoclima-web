// static/js/main.js

// Importamos los inicializadores de nuestros módulos
import { initAuth } from './auth.js';
import { initUI } from './interfaz.js';

// Esperamos a que el HTML (DOM) esté completamente cargado
document.addEventListener('DOMContentLoaded', () => {
    console.log("Inicializando Meteoclima Forecast...");

    // 1. Inicializar la Interfaz de Usuario
    // (Ata todos los eventos a los botones, sliders y selectores del HTML)
    initUI();

    // 2. Inicializar la Autenticación
    // (Verifica la sesión en Firebase. Si el usuario está logueado, 
    // descargará la llave AES, cargará el mapa base y renderizará los datos iniciales)
    initAuth();
});

// ==========================================
// EXPOSICIÓN DE FUNCIONES GLOBALES RESTANTES
// ==========================================
// Si tienes botones en tu HTML que usan "onclick='funcion()'", 
// deben estar expuestos al objeto window.
window.abrirModalNiveles = function() {
    let m = document.getElementById('modal-niveles');
    if(m) m.classList.remove('hidden');
};

window.cerrarModalNiveles = function() {
    let m = document.getElementById('modal-niveles');
    if(m) m.classList.add('hidden');
};