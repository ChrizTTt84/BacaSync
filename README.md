<p align="center">
  <img width="128" alt="BacaSync" src="assets/icon.png">
</p>

<h1 align="center">
  BacaSync
</h1>
<p align="center">
  <b>Aplicacion de escritorio multiplataforma Windows + macOS para sincronizar carpetas con NAS en modo cache SSD local.</b>
  <br>
  Sin perder nunca archivos. Incremental. Con programacion automatica y arranque al encender el equipo.
</p>
<p align="center">
  <a href="#-garantia-anti-perdida-de-datos-nas-%EF%B8%8F">
    <img src="https://img.shields.io/badge/🛡️_GARANTIA_ANTI_PERDIDA_NAS-100%25_OK-brightgreen" alt="Garantia anti-perdida NAS">
  </a>
  <a href="#">
    <img src="https://img.shields.io/badge/Windows_10%2F11-x64-0078D4?logo=windows11&logoColor=white" alt="Windows x64">
  </a>
  <a href="#">
    <img src="https://img.shields.io/badge/macOS_Intel-x64-000000?logo=apple&logoColor=white" alt="macOS Intel">
  </a>
  <a href="#">
    <img src="https://img.shields.io/badge/macOS_M1%2FM2%2FM3-arm64-000000?logo=apple&logoColor=white" alt="macOS Apple Silicon arm64 - SIN Rosetta">
  </a>
</p>

---

## 🛡️ GARANTIA ANTI-PERDIDA DE DATOS NAS (REGLA INVIOLABLE) ⚠️

**Lee esto primero. Es lo mas importante de la aplicacion.**

> ### `Push Local → NAS = NUNCA SE FILTRA`
>
> Si **tu modificas / creas un archivo en tu DISCO LOCAL SSD (cache)** aunque **ese archivo NO ESTE MARCADO** en la cache selectiva del arbol NAS:
>
> **SIEMPRE SE SUBIRÁ al NAS** cuando pulses Sincronizar ahora / Push / o cierres la app (flushOnExit).
>
> Esta regla **NO SE PUEDE DESACTIVAR por diseño**, para que **nunca pierdas tu trabajo local** por una mala seleccion accidental en el arbol de cache selectiva.
>
> ### ¿Cuando se filtra entonces?
> **Solo en el `Pull NAS → Local` (descargar del NAS a tu SSD).**
>
> La cache selectiva significa: *"No me descargues TODO el NAS (ahorra espacio SSD). Solo bajame las carpetas que marque aquí"*. **Tu trabajo local jamás se toca ni se borra** por el filtro.
>
> Orden de ejecucion en cada sync:
> 1. `mkdir` — se crean primero las carpetas nuevas
> 2. `copy` — se copian los archivos nuevos / modificados
> 3. `delete` — SOLO en modo espejo y SOLO al final, lo que ya no exista en origen. Nunca se borra primero.

---

## ✨ Caracteristicas

| | Caracteristica |
|---|---|
| ✅ | **Multiplataforma** — Windows 10/11 x64, macOS Intel x64 y macOS Apple Silicon arm64 (M1/M2/M3/M4) **SIN necesidad de Rosetta 2**. |
| ✅ | **Modo Cache NAS** — Trabaja tus archivos pesados localmente en SSD super rapido, sincroniza incremental al NAS. |
| ✅ | **Cache selectiva con arbol tri-state** — Solo descarga del NAS lo que realmente necesites (ahorra espacio SSD). |
| ✅ | **Sincronizacion incremental** — Compara tamaño + fecha de modificacion (±2s). Solo copia / elimina lo que cambió. No re-copia toda la carpeta. |
| ✅ | **Auto-arranque al encender el equipo** — Configuración nativa multiplataforma `app.setLoginItemSettings` (sin tocar registro / plists). |
| ✅ | **Sigue corriendo al cerrar la ventana** — Se oculta en la bandeja / barra menú. Antes de Salir se hace un **flushOnExit** (Push automatico de tus cambios locales al NAS), **nunca pierdes nada al apagar el PC**. |
| ✅ | **Programacion** — Manual / cada hora / cada 6h / diario / semanal / mensual. Guardado en JSON y restaurado al reiniciar la app / el PC. |
| ✅ | **Vista previa** — Antes de tocar NADA, ve la lista exacta de lo que se va a copiar / borrar / crear. 100% transparente. |
| ✅ | **Icono bandeja NO BLANCO** — Fallback triple: archivos PNG/ICO/ICNS + buffer base64 embebido + generador pixel-art PNG en runtime. Nunca un espacio en blanco. |
| ✅ | **Persistencia JSON userData** — `bacasync-jobs.json` y `bacasync-settings.json`. Sin base de datos. Facil de migrar / hacer backup. |
| ✅ | **Escritura atomica con reintentos backoff** — Windows Defender / antivirus bloqueando el JSON? No hay problema: escritura `.tmp` + `rename` y 6 reintentos con espera creciente. |
| ✅ | **Copiado de CARPETAS VACIAS** — Incluso las anidadas sin archivos. No se pierde estructura. |
| ✅ | **3 builds oficiales via GitHub Actions** — Windows + macOS Intel + macOS Apple Silicon. Descarga los artefactos directo desde Actions. |

---

## 🚀 Descarga e instalacion

### 1. Ve a Actions del repositorio

Abre **[la pestaña Actions](https://github.com/ChrizTTt84/BacaSync/actions)** y filtra por el workflow **Build BacaSync (Windows + macOS)**.

Elige el run mas reciente que este en **verde ✓** y baja a la seccion **Artifacts**. Hay 3 zip:

| Artefacto | Plataforma | Uso |
|---|---|---|
| `BacaSync-Windows-x64.zip` | Windows 10 / 11 x64 | Descomprime, ejecuta `BacaSync Setup 1.0.0.exe`. SmartScreen → Informacion adicional → Ejecutar de todos modos. |
| `BacaSync-macOS-arm64-AppleSilicon.zip` | Apple Silicon M1 / M2 / M3 / M4 | **SIN Rosetta**. Abrir DMG → Arrastrar BacaSync a Aplicaciones. 1ª vez: Boton derecho en BacaSync.app → Abrir → Abrir. |
| `BacaSync-macOS-x64-Intel.zip` | Mac antiguos con procesador Intel | Mismo procedimiento que ARM, pero solo para chips Intel. |

---

### 2. Ajustes globales la 1ª vez

Pulsa el boton **⚙️ Ajustes** en la barra superior:

- ☑️ **`Iniciar automaticamente al encender el equipo`** → (Recomendado).
- ☐ **`Arrancar minimizado a la bandeja`** → si prefieres que no aparezca la ventana al iniciar el PC.
- ☑️ **`Mantener la app en bandeja al cerrar la ventana`** → **Siempre activo, no se puede desmarcar**. Cerrar la X = ocultar, NO cerrar. Para salir: menu bandeja → **Salir**.

---

### 3. Crea tu 1ª tarea (Modo Cache NAS)

1. **+ Nueva tarea de sincronizacion** → selecciona **Modo cache NAS**.
2. **Carpeta NAS** (`☁️`) → carpeta compartida SMB del NAS (ej `\\192.168.x.x\Proyectos`).
3. **Carpeta local SSD** (`💻`) → **pulsa `Sugerir carpeta`** (crea una en tu perfil, vacia, perfecta).
4. **Modo sincronizacion** → Espejo (recomendado).
5. **Programacion** → Manual o cada X tiempo.
6. **Guardar tarea**.

---

### 4. Cache selectiva (solo si no quieres TODO el NAS en tu SSD)

En la tarea Modo NAS → **Configurar cache selectiva**:

- Marca las carpetas / archivos del NAS que SI quieres descargarte a tu SSD.
- Usa: `Incluir TODO` | `Expandir todo` | `Colapsar todo` | `Ninguno`.
- Pulsa **Guardar seleccion**.
- ⚠️ Recordatorio: **esto solo filtra el Pull.** Lo que modifiques en local siempre se sube.

---

## 🖱️ Botones del detalle de la tarea

Selecciona la tarea en la lista izquierda → veras:

| Boton | Accion |
|---|---|
| ▶️ **Sincronizar ahora** | Ejecuta el modo completo elegido. |
| 📋 **Vista previa** | **Sin tocar archivos**: te muestra TODO lo que va a hacer. Usalo la 1ª vez para estar seguro. |
| ⬇️ **Traer del NAS (Pull)** | Descarga del NAS a tu SSD. Aplica cache selectiva. |
| ⬆️ **Subir al NAS (Push)** | Sube de SSD al NAS. Siempre sube TODO lo modificado local. Sin filtros, garantia anti-perdida. |
| ✏️ Editar | Cambia nombre / rutas / programacion. |
| 🗑️ Eliminar | Borra solo la TAREA. Nunca borra tus archivos en los discos. |

---

## 🔧 Problemas comunes y soluciones (FAQ)

### 1. `EPERM: operation not permitted, copyfile / mkdir ...`
Si el path que falla empieza por `\\NAS\...` o `smb://...`:
- **No es un fallo de BacaSync.** Son **permisos SMB del NAS**, tu usuario no puede escribir en esa carpeta.
- Como prueba: abre la carpeta en Explorador / Finder, intenta **crear una carpeta nueva a mano**. Si tampoco puedes → confirmado, permiso en solo lectura.
- Arreglo: entra al panel web de tu NAS (Synology/QNAP/TrueNAS/etc.) → Recursos compartidos → Permisos → Lectura/Escritura (Read/Write) a tu usuario.
- En Windows: **Panel de control → Administrador de credenciales → Credenciales de Windows → Agregar credencial generica**:
  - Direccion: `\\IP_DE_TU_NAS`
  - Usuario / Password: tus credenciales del NAS. Guarda.

### 2. macOS: "Este desarrollador no esta identificado" / "Esta app danara tu ordenador"
- **NO abras con doble clic**. Boton derecho sobre `BacaSync.app` → **Abrir**. Ahora el dialogo SI tendra el boton **Abrir**. Pulsa.
- O: **Ajustes → Privacidad y seguridad → baja → Permitir de todos modos**.

### 3. Windows SmartScreen impide la instalacion
- Pulsa **Informacion adicional** en el dialogo rojo. Ahora aparece el boton **Ejecutar de todos modos**.
> Los instaladores no tienen certificado EV (Extended Validation) de Microsoft / Apple Developer ID por ahora. Si quieres firmarlos en el futuro, agrega los secrets en Settings → Secrets and variables → Actions: `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`.

### 4. `EPERM open bacasync-jobs.json` al guardar
- Tu antivirus / Windows Defender escaneaba el JSON.
- BacaSync ya tiene **escritura atomica `.tmp` + rename + 6 reintentos con backoff**, reintenta 2 veces, normalmente el 2º intento va bien.

### 5. Las tareas programadas no se ejecutan al cerrar la ventana
- Cerrar la X = **ocultar en bandeja**, NO cerrar la app. La app debe estar corriendo (icono en bandeja visible) para ejecutar las tareas en horario.
- Si pulsaste **Salir** desde el menu bandeja → la app SI se cerro; no ejecuta nada.

### 6. Solo se copian archivos y NO las carpetas vacias
- Arreglado en la v1.0.0; se copian incluso las carpetas vacias anidadas.
- Si usas una tarea creada en versiones antiguas: borra la tarea y crea una NUEVA con los mismos paths.

---

## 💾 Archivos de configuracion (backup / migracion)

**100% offline, sin registro, sin base de datos.** Todo JSON plano en `app.getPath('userData')`. Copia estos 2 archivos para migrar entre equipos:

| Plataforma | Ruta |
|---|---|
| Windows | `%APPDATA%\BacaSync\bacasync-jobs.json` <br> `%APPDATA%\BacaSync\bacasync-settings.json` |
| macOS | `~/Library/Application Support/BacaSync/bacasync-jobs.json` <br> `~/Library/Application Support/BacaSync/bacasync-settings.json` |

---

## 🛠️ Desarrollo y compilacion local

Requisitos: **Node.js 20 o 22 LTS** + npm.

```bash
# Clona el repo
git clone https://github.com/ChrizTTt84/BacaSync.git
cd BacaSync

# Instala dependencias
npm install

# Genera iconos (PNG de todos los tamanos, ICO Windows, ICNS macOS + fallback base64)
npm run build:icons

# Compila TypeScript + copia archivos renderer a dist/renderer/
npm run build

# Arranca en modo desarrollo
npm start
```

### Empaquetado local

Empaqueta solo para **la plataforma en la que estes**:
```bash
npm run pack:win          # Windows x64 (solo desde Windows)
npm run pack:mac-arm64    # macOS Apple Silicon (solo desde Apple Silicon Mac)
npm run pack:mac-x64      # macOS Intel (solo desde macOS)
```
> Nunca intentes `pack:mac` desde Windows (electron-builder no lo permite). Los builds multiplataforma se hacen SIEMPRE con GitHub Actions, que tiene runners nativos macOS Intel y Apple Silicon.

### Builds multiplataforma oficiales (CI/CD)

En **[Actions → Run workflow](https://github.com/ChrizTTt84/BacaSync/actions)** → rama main → Run.
3 jobs se ejecutan:
- `windows-latest` → `BacaSync-Windows-x64.zip`
- `macos-13` (Intel) → `BacaSync-macOS-x64-Intel.zip`
- `macos-14` (M1/M2/M3/M4) → `BacaSync-macOS-arm64-AppleSilicon.zip`

Si haces un push de tag `v*` (ej: `v1.0.1`) se sube automaticamente al Release los 3 instaladores.

---

## 📜 Proximas mejoras (opcionales por pedir)

- [ ] **Liberar espacio local** — boton para borrar archivos de tu cache SSD **sin borrarlos del NAS** (ahorrar espacio sin riesgo).
- [ ] **Log detallado de operaciones** — archivo `.txt` / `.csv` en userData/logs con cada copia / move / delete + fecha + peso.
- [ ] **Aviso de actualizaciones** — comprobar nuevos `Releases` en GitHub al arrancar.
- [ ] **Firma de instaladores oficial** — Certificados EV Windows + Apple Developer ID (secrets: `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`).

---

## 👥 Autor

Creado por **ChrizTTt84**.

---

<p align="center">
  <i>¡Sincroniza sin miedos. Tu trabajo en local SIEMPRE se sube al NAS. 100%.</i>
</p>
