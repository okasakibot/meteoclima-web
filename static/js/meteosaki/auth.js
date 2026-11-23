// static/js/meteosaki/auth.js

import {
    signInWithPopup,
    signInWithEmailAndPassword,
    onAuthStateChanged,
    signOut
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

import { state, auth, db, provider } from "./config.js";
import { cargarMapaBase } from "./mapa.js";
import { actualizarMapa } from "./datos.js";
import { actualizarTextosFecha } from "./interfaz.js";

const btnLogin = document.getElementById('btn-login');
const formEmail = document.getElementById('form-login-email');
const btnLoginEmail = document.getElementById('btn-login-email');
const authErrorEl = document.getElementById('auth-error');

const METEOCLIMA_LOGO = '../static/img/logo.svg';
let sesionIniciada = false;

function mostrarError(msg) {
    if (!authErrorEl) return;
    authErrorEl.innerText = msg;
    authErrorEl.classList.remove('hidden');
}

function limpiarError() {
    if (!authErrorEl) return;
    authErrorEl.innerText = '';
    authErrorEl.classList.add('hidden');
}

function restaurarBotonesLogin() {
    if (btnLogin) {
        btnLogin.innerHTML = "Iniciar sesión con Google";
        btnLogin.disabled = false;
        btnLogin.className = "w-full px-5 py-2.5 bg-blue-600 text-white text-sm font-bold rounded-lg hover:bg-blue-700 transition shadow-lg cursor-pointer flex items-center justify-center gap-3";
    }
    if (btnLoginEmail) {
        btnLoginEmail.innerText = "Iniciar sesión";
        btnLoginEmail.disabled = false;
    }
}

async function obtenerDatosUsuarioPermitido(email) {
    if (!email) return null;
    // Intenta primero con el correo tal cual y luego en minúsculas
    let snap = await getDoc(doc(db, "allowed_users", email));
    if (!snap.exists() && email !== email.toLowerCase()) {
        snap = await getDoc(doc(db, "allowed_users", email.toLowerCase()));
    }
    return snap.exists() ? snap.data() : null;
}

export function initAuth() {
    // 1. Escuchador del estado de autenticación
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            if (sesionIniciada) return;

            limpiarError();
            if (btnLogin) btnLogin.innerText = "Conectando al servidor...";

            try {
                // Consultamos metadatos del modelo y perfil en allowed_users en paralelo
                const [docSnap, allowedUser] = await Promise.all([
                    getDoc(doc(db, "metadatos_modelo", "estado_actual")),
                    obtenerDatosUsuarioPermitido(user.email)
                ]);

                if (!allowedUser) {
                    await signOut(auth);
                    throw new Error("Tu correo no está autorizado en allowed_users.");
                }

                if (!docSnap.exists()) {
                    throw new Error("No hay documento de estado_actual en BD.");
                }

                const data = docSnap.data();
                state.fechaActual = data.fecha_disponible;

                if (!state.fechaActual || state.fechaActual.length < 10) {
                    throw new Error("El formato de fecha_disponible en Firestore es incorrecto. Debe incluir hora (%Y%m%d%H).");
                }

                // Importar llave criptográfica AES-GCM
                const rawKey = Uint8Array.from(atob(data.llave_aes), c => c.charCodeAt(0));
                state.cryptoKey = await crypto.subtle.importKey(
                    "raw", rawKey, { name: "AES-GCM", length: 256 }, true, ["decrypt"]
                );

                // --- Lógica de Nombre, Foto y Role ---
                const isGoogle = user.providerData.some(p => p.providerId === 'google.com');
                const dbName = allowedUser.nombre || allowedUser.Nombre || allowedUser.name || allowedUser.Name || user.email.split('@')[0];
                const role = String(allowedUser.Role ?? allowedUser.role ?? '').trim();
                const isMeteoclima = role === 'Meteoclima';

                const profileUI = document.getElementById('user-profile');
                const profileName = document.getElementById('profile-name');
                const profileImg = document.getElementById('profile-img');
                const profileLevelIcon = document.getElementById('profile-level-icon');
                const profileLevelName = document.getElementById('profile-level-name');
                const btnInfoNiveles = document.getElementById('btn-info-niveles');
                const btnCrono = document.getElementById('btn-cronograma');

                // Nombre y foto según proveedor
                if (profileName) {
                    profileName.innerText = isGoogle ? (user.displayName || dbName) : dbName;
                }
                if (profileImg) {
                    profileImg.src = (isGoogle && user.photoURL) ? user.photoURL : METEOCLIMA_LOGO;
                    profileImg.classList.remove('hidden');
                }

                // Visibilidad de niveles y cronograma según Role
                if (isMeteoclima) {
                    profileLevelIcon?.classList.remove('hidden');
                    btnInfoNiveles?.classList.remove('hidden');
                    btnCrono?.classList.remove('hidden');
                    if (profileLevelName) {
                        profileLevelName.innerText = allowedUser.nivel || 'Lvl. Pollito';
                    }
                } else {
                    profileLevelIcon?.classList.add('hidden');
                    btnInfoNiveles?.classList.add('hidden');
                    btnCrono?.classList.add('hidden');
                    if (profileLevelName) {
                        profileLevelName.innerText = role || 'Invitado';
                    }
                }

                // Mostrar interfaz principal
                document.getElementById('auth-overlay').style.display = 'none';
                document.getElementById('bottom-bar').classList.remove('translate-y-full');
                document.getElementById('right-panel').classList.remove('opacity-0', 'pointer-events-none');
                profileUI?.classList.remove('hidden');

                sesionIniciada = true;

                // --- Disparadores Iniciales del Mapa ---
                actualizarTextosFecha(0);
                cargarMapaBase(document.getElementById('config-basemap')?.value || 'satellite1');
                await actualizarMapa();

            } catch (error) {
                console.error("Error validando metadatos Auth:", error);
                mostrarError("Error: " + error.message);
                restaurarBotonesLogin();
            }
        } else {
            // Usuario no logueado
            restaurarBotonesLogin();
            document.getElementById('auth-overlay').style.display = 'flex';
            document.getElementById('user-profile')?.classList.add('hidden');
            document.getElementById('btn-cronograma')?.classList.add('hidden');
            sesionIniciada = false;
        }
    });

    // 2. Botón de Cerrar Sesión
    document.getElementById('btn-logout')?.addEventListener('click', () => {
        const btnOut = document.getElementById('btn-logout');
        if (btnOut) btnOut.innerText = "Saliendo...";
        signOut(auth).then(() => {
            window.location.reload();
        }).catch((error) => {
            console.error("Error al cerrar sesión:", error);
            if (btnOut) btnOut.innerText = "Error";
        });
    });

    // 3. Login con Google (Popup)
    btnLogin?.addEventListener('click', () => {
        limpiarError();
        btnLogin.innerText = "Abriendo Google...";
        btnLogin.disabled = true;
        signInWithPopup(auth, provider).catch(err => {
            console.error("Fallo popup Auth:", err);
            mostrarError("No se pudo iniciar sesión con Google.");
            restaurarBotonesLogin();
        });
    });

    // 4. Login con Email y Contraseña
    formEmail?.addEventListener('submit', async (e) => {
        e.preventDefault();
        limpiarError();

        const email = document.getElementById('login-email')?.value.trim();
        const pass = document.getElementById('login-password')?.value;
        if (!email || !pass) return;

        if (btnLoginEmail) {
            btnLoginEmail.innerText = "Verificando...";
            btnLoginEmail.disabled = true;
        }

        try {
            await signInWithEmailAndPassword(auth, email, pass);
        } catch (err) {
            console.error("Fallo login Email/Pass:", err);
            const msg = (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password' || err.code === 'auth/user-not-found')
                ? "Correo o contraseña incorrectos."
                : `Error al iniciar sesión (${err.code}).`;
            mostrarError(msg);
            restaurarBotonesLogin();
        }
    });
}
