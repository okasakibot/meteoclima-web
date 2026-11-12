// static/js/auth.js

import { signInWithPopup, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// Importamos el estado global y las instancias de Firebase
import { state, auth, db, provider } from "./config.js";

// Importamos las funciones de otros módulos que deben ejecutarse al loguearse
import { cargarMapaBase } from "./mapa.js";
import { actualizarMapa } from "./datos.js";
import { actualizarTextosFecha } from "./interfaz.js";

const btnLogin = document.getElementById('btn-login');
let sesionIniciada = false;

// Restaura visualmente el botón si falla el login o si no hay usuario
function restaurarBotonLogin() {
    if (btnLogin) {
        btnLogin.innerHTML = "Iniciar sesión con Google";
        btnLogin.disabled = false;
        btnLogin.className = "px-6 py-3 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 transition shadow-lg cursor-pointer flex items-center gap-3";
    }
}

// Exportamos esta función principal para inicializarla desde main.js
export function initAuth() {
    // 1. Escuchador del estado de autenticación
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            if (sesionIniciada) return;

            if (btnLogin) btnLogin.innerText = "Conectando al servidor...";
            try {
                const docRef = doc(db, "metadatos_modelo", "estado_actual");
                const docSnap = await getDoc(docRef);

                if (docSnap.exists()) {
                    const data = docSnap.data();

                    // Guardamos la fecha en el estado global
                    state.fechaActual = data.fecha_disponible;

                    if (!state.fechaActual || state.fechaActual.length < 10) {
                        throw new Error("El formato de fecha_disponible en Firestore es incorrecto. Debe incluir hora (%Y%m%d%H).");
                    }

                    // Guardamos la llave criptográfica en el estado global
                    const rawKey = Uint8Array.from(atob(data.llave_aes), c => c.charCodeAt(0));
                    state.cryptoKey = await crypto.subtle.importKey(
                        "raw", rawKey, { name: "AES-GCM", length: 256 }, true, ["decrypt"]
                    );

                    // --- Actualización de la Interfaz (UI) ---
                    document.getElementById('auth-overlay').style.display = 'none';
                    document.getElementById('bottom-bar').classList.remove('translate-y-full');
                    document.getElementById('right-panel').classList.remove('opacity-0', 'pointer-events-none');

                    const btnCrono = document.getElementById('btn-cronograma');
                    if(btnCrono) btnCrono.classList.remove('hidden');

                    const profileUI = document.getElementById('user-profile');
                    const profileName = document.getElementById('profile-name');
                    const profileImg = document.getElementById('profile-img');

                    if (profileName) profileName.innerText = user.displayName || user.email.split('@')[0];
                    if (user.photoURL && profileImg) {
                        profileImg.src = user.photoURL;
                        profileImg.classList.remove('hidden');
                    }
                    if (profileUI) profileUI.classList.remove('hidden');

                    sesionIniciada = true;
                    
                    // --- Disparadores Iniciales del Mapa ---
                    actualizarTextosFecha(0);
                    cargarMapaBase(document.getElementById('config-basemap')?.value || 'terrain-esri');
                    await actualizarMapa();

                } else {
                    throw new Error("No hay documento de estado_actual en BD.");
                }
            } catch (error) {
                console.error("Error validando metadatos Auth:", error);
                document.getElementById('auth-error').innerText = "Error: " + error.message;
                document.getElementById('auth-error').classList.remove('hidden');
                restaurarBotonLogin();
            }
        } else {
            // Usuario no logueado
            restaurarBotonLogin();
            document.getElementById('auth-overlay').style.display = 'flex';
            document.getElementById('user-profile').classList.add('hidden');
            sesionIniciada = false;
        }
    });

    // 2. Botón de Cerrar Sesión
    document.getElementById('btn-logout')?.addEventListener('click', () => {
        auth.signOut().then(() => window.location.reload());
    });

    // 3. Botón de Iniciar Sesión (Popup de Google)
    btnLogin?.addEventListener('click', () => {
        btnLogin.innerText = "Abriendo Google...";
        signInWithPopup(auth, provider).catch(err => {
            console.error("Fallo popup Auth:", err);
            restaurarBotonLogin();
        });
    });
}