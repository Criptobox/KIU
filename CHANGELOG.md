# Changelog

Formato basado en Keep a Changelog. Fechas en 2026.

## [2.8.0] — Un solo controlador de estados para el avatar

El bot se movía raro porque **dos capas distintas peleaban por su estado**: `kiu-avatar-boot.js`
envolvía `window.KiuBridge` con un `Proxy` y *adivinaba* el estado mirando cada llamada al
puente, mientras `app-ui.js`, `motor.js` y `models.js` llamaban `KiuAvatar.set()` por su cuenta.
Los dos caminos se pisaban. Ahora hay un solo dueño del estado.

### Nuevo: `js/kiu-estados.js` (controlador por capas y prioridad)
- `KiuState.set(capa, estado[, ms])` · `.flash(capa, estado, ms)` · `.clear(capa)` · `.reset()` · `.get()` · `.snapshot()` · `.on(fn)`.
- Capas y prioridad: `err 90 > job 70 > pausa 65 > ruta 60 > voz 50 > tool 35 > flash 30 > rag 25 > rest 10`.
  Lo persistente manda y **un flash solo se ve si no hay nada de mayor prioridad activo**.
- `pause` existe porque 'Proveedor en pausa' con prioridad de flash nunca se habría visto:
  'Enrutando' estaba activo justo mientras se prueba el siguiente modelo.
- `rag` va por debajo de `flash` a propósito: 'RAG apagado' es un estado de reposo y si viviera
  más arriba taparía para siempre los avisos.
- La caducidad la decide el reloj de cada capa, no el temporizador: con la WebView en segundo
  plano los `setTimeout` no corren y el bot se quedaba con el estado viejo.
- `set('ruta', …)` lleva red de seguridad de 2 min: una promesa colgada no deja al bot clavado
  en «Enrutando». Es un temporizador del controlador, no un timer suelto más.
- `window.KiuState` ya lo usaba `app-ui.js` para los **ajustes** (`window.KiuState = S`): ese
  alias sin uso pasó a llamarse `window.KiuSettings` para liberar el nombre. `S` sigue igual.

### Bugs que se fueron
- **«Respuesta lista» mientras seguía generando**: el `Proxy` daba la generación por terminada a
  los 2,5 s sin sondeo, y con el streaming por push ya no hay sondeo. Ahora la enciende y la
  apaga `Kiu.ask`.
- **«Cargado» en cada mensaje**: `ensureLoaded()` llama `kiuIsLoaded` antes de cada envío y el
  `Proxy` lo leía como «recién cargó». `ensureLoaded` ya no toca el avatar.
- **Alias viejos apuntando al estado equivocado**: `think` iba a «Armando prompt» (no a
  «Generando»), `work` al engranaje de «Acción del dispositivo» (se veía al cargar o descargar
  un modelo), `search` a «Indexando» (lupa sobre un documento, en una búsqueda web) y `create` a
  «RAG activo» (al pedir un poema aparecía el libro). Ahora `think`/`create` → «Generando»,
  `search` → «Enrutando», `work` → «Cargando»; la acción en el teléfono se sigue pidiendo con
  `alert`/`action`.
- **Reposo desactualizado**: `set()` no actualizaba el estado base y los flashes volvían a un
  valor viejo (podía quedar en «Generando» con la respuesta ya escrita). El estado base lo
  calcula ahora `App.avatarRest()` con la verdad a la vista.
- **«Entrada» con cualquier campo de texto**: el listener global de `input` reaccionaba a
  Ajustes, claves de API y el buscador del navegador. Va atado al input del chat.
- **Timers sueltos**: el de `kiuLoad` forzaba «Inactivo» a los 90 s aunque hubiera otro estado;
  «Escuchando» duraba 9 s fijos y «Hablando» se calculaba por el largo del texto. Ahora mandan
  `nexoTtsStart`/`nexoTtsDone` y `nexoListenStart`/`nexoListenEnd`.
- **El `Proxy` sobre `KiuBridge` se eliminó** y con él el listener global de `input`.
  `kiu-avatar-boot.js` queda con lo suyo: montar y re-ajustar tamaño.

### Estados que nunca se veían (ya tienen dueño)
- `Enrutando` — al mandar un mensaje, abrir el navegador embebido o esperar un proveedor.
- `Proveedor en pausa` — cuando un proveedor falla y `Rtr.fail()` lo aparta.
- `Sin modelo` / `Usar nube/Ollama` / `Motor no soportado` — en `App.avatarRest()`, según lo que
  haya en `S.dl.done` y si el motor interno está disponible en ese teléfono.
- `Disparado` — `ReminderReceiver` manda un broadcast interno y `MainActivity` lo traduce a
  `nexoAlarmFired` si la WebView está viva.
- `Reprogramado al reiniciar` — `BootReceiver` cuenta cuántas alarmas rearma, lo guarda en
  `kiu_native.resched` y la UI lo consume con `kiuTakeRescheduled()` (take-once).
- `RAG apagado` — estado pegado de la capa `rag`, no un aviso de 2,5 s.

### Otros arreglos
- **El avatar no reinicia las animaciones en cada cambio**: `set()` reescribía el SVG entero
  (ojos, boca, brazos, antena, objeto y `className`). Ahora guarda qué pintó y solo toca lo que
  cambió; el `className` del cuerpo se reasigna únicamente si es distinto.
- **`KiuAvatar.state()` devuelve el nombre real** del estado del mapa, no el alias viejo de 13
  nombres; `KiuAvatar.oldState()` conserva la vista vieja. El pill del chat se arma con los 37
  estados: antes todo lo que no fuera de esos 13 caía en «Listo para empezar» mientras el bot
  descargaba un modelo.
- **Permiso de alarma exacta con diálogo propio**: al agendar un recordatorio en Android 12+
  se avisa (estado «Sin permiso de alarma exacta») y se lleva a Ajustes del sistema. Antes solo
  había un botón suelto en Preferencias y ningún aviso al agendar. `App.confirm` acepta
  `cancelLabel`.
- **`{{key:x}}` atado a los hosts de su proveedor** (`KiuApiProxy`): el placeholder solo se
  sustituye si la petición va a un host de ese proveedor. Un host de un proveedor conocido nunca
  recibe la clave de otro; el proveedor personalizado del usuario sigue funcionando.
- **Wake word tras reiniciar en Android 14**: desde `BOOT_COMPLETED` ya no se puede arrancar un
  servicio con micrófono. Antes fallaba en silencio y Kiu figuraba como despierto sin estarlo;
  ahora manda una notificación pidiendo abrir la app una vez.
- **Test inestable arreglado**: `parseWhen('a las 9 de la manana')` fallaba pasadas las 9:00
  porque asumía la hora actual. El código estaba bien (a las 10, las 9 de la mañana ya pasaron y
  la próxima ocurrencia es mañana); el test ahora congela el reloj y hay un caso para cada
  rama. Verificado en 5 zonas horarias.
- **`tests/estados.test.mjs` (nuevo, 16 tests)** fija el contrato del controlador: prioridades,
  un flash que no pisa a lo persistente, la caducidad por reloj, los alias y las regresiones
  del Proxy. Suite completa: 115 tests, 115 pasan.

## [2.7.5] — Arreglos de arranque y CI

- **Error «Sys is not defined» al abrir** (`motor.js:596`): `Sys` vivía solo dentro de `app-ui.js`; ahora se exporta a `window`.
- **El bot grande del inicio no se dibujaba**: `attachShadow` no se permite en `<button>`; `kiu-avatar.js` usa un hijo como host cuando falla.
- **El bot de la esquina se movía de un lado a otro y tapaba el «Kiu»**: los movimientos del cuerpo estaban en px fijos (pensados para el bot de 190 px) y en el mini de 36 px eran enormes. Ahora escalan con su tamaño (`--u` = tamaño/190).
- **Bot pequeño (esquina, chat, perfil) quieto en su sitio**: por debajo de 60 px el cuerpo ya no se desplaza ni se sacude de lado en ningún estado, solo flota suave. El estado se sigue leyendo por cara, brazos, antena y objeto, como en el mapa de estados. El bot grande del inicio mantiene todas sus animaciones.
- **CI**: `android.useAndroidX=true`, reintento de la descarga de Gradle, `llama_sampler_init_penalties` tolerante a cambios de firma y un resumen con el error real de compilación.

## [2.7.0] — Tanda 8: refactorización del frontend, RAG en Web Worker y CI blindado

### Consolidación del avatar
- **`avatar.js` eliminado**: el robot viejo de 13 estados ya no se cargaba desde index.html
  (solo quedaba como "referencia" con 12,9 KB muertos). El bot de `kiu-avatar.js` (37 estados)
  es el único avatar y mantiene la capa de compatibilidad (`KiuAvatar.set/flash/state/pick`
  entienden los nombres de estado viejos).
- **Inicialización unificada en `kiu-avatar-boot.js`**: una sola vía de montaje — los huecos
  `[data-avatar]` y `[data-avatar-mini]` que declara el HTML. Fuera el loader dinámico de
  emergencia, el reemplazo de "avatares ajenos" (búsqueda por selectores/texto de saludo) y el
  `MutationObserver` de 20 s: el arranque es directo, con un reintento a 800 ms y `refit`
  para pantallas que se abren después.

### RAG en Web Worker (UI que no se congela)
- **`js/rag-worker.js` (nuevo)**: núcleo puro del RAG en UN solo archivo con dos modos, al
  estilo pdf.js + pdf.worker.min.js. En el hilo principal expone `window.KiuRagCore`
  (tokenización, fragmentación, tf, BM25) para que la matemática no esté duplicada; en modo
  worker atiende `{id, op}`: `prep` (fragmenta + precalcula tf), `sync` (espeja el índice sin
  textos), `drop`, `search` (BM25 → top-k) y responde siempre con el mismo `id`.
- **`rag.js` v3.1**: delega toda la matemática en `KiuRagCore` (cero duplicación) y corre la
  fragmentación de documentos grandes y el cálculo de similitud en el worker. `addText` manda
  el texto crudo al worker (un doc de 30 MB ya no bloquea el hilo de la UI); nuevo
  `RAG.searchAsync(q,k,cb)` con guardia de 2 s (si el worker se cuelga, contesta con el índice
  local), `RAG.hits(q,k)` estructurado y `RAG.ctxFor(q,k,cb)` para los flujos de chat. Sin
  worker (WebView vetusto / VM de tests) todo cae a las rutas síncronas de siempre.
- **app-ui**: `kiuReply` y `apiStream` resuelven ahora el contexto de documentos con
  `RAG.ctxFor` (worker) antes de armar el prompt; `kiuMsgs`/`apiMsgs` aceptan `preCtx`
  precalculado. La búsqueda web (`msgsOverride`) no toca RAG, como antes.
- **Contrato react.js ↔ rag.js corregido (bug real)**: `searchDocs` llamaba a
  `RAG.search()` esperando un array de `{doc, txt}` pero `search` devuelve un STRING para
  inyectar al prompt: el paso "docs" del ReAct citaba caracteres sueltos. Ahora usa
  `RAG.hits()` (estructurado) y un test nuevo documenta el descontrato.

### Puente JS↔Java y seguridad
- **Auditoría automática del puente**: `scripts/bridge_audit.py` cruza los 84 métodos
  `@JavascriptInterface` de `MainActivity.java` contra todos los nombres que invoca el JS
  (`BR.x`, `bridge('x')`, `rawBridge('x')`, `B.x`, `KiuBridge.x`) y los 5 eventos Java→JS
  (`kiuPush`, `kiuNativeDone`, `kiuDataRestore`, `kiuSkillInstall`, `kiuMorningSummary`).
  Resultado: contrato OK, cero llamadas fantasma. Documentados en `BRIDGE_API.md` los dos
  métodos que faltaban (`contacts`, `addCalendarEvent`) y la lista completa de eventos push.
- **Heurística general de API en `kiu-secure.js`** (pendiente de KNOWN_ISSUES): un proveedor
  nuevo ya no exige editar la lista de hosts de nube. HTTPS distinto del origen de la app con
  ruta con pinta de API (`/v1`, `/v1beta`, `/api`, `/chat/completions`, `/messages`,
  `/embeddings`…) viaja por el proxy de Java, que igual exige HTTPS, limita a 8 MB y mantiene
  la clave fuera del WebView.
- **`llama_backend_free()` en `freeModel()`** (pendiente de KNOWN_ISSUES): el backend global
  de llama.cpp se libera al liberar el motor; `loadModel()` lo re-inicializa solo
  (`g_backend_ready` → recarga de modelo después de un free sigue funcionando).

### Tests, ProGuard y CI/CD
- **Suite ampliada de 50 → 85 tests**: nuevos `tests/app-core.test.mjs` (16: env, state,
  catalog, models, motor — plantillas de chat, KB, streaming por push, bóveda),
  `tests/i18n.test.mjs` (4), `tests/migrate.test.mjs` (4: idempotencia del ferry, payload
  corrupto, exportación completa) y `tests/rag-worker.test.mjs` (9: núcleo + protocolo del
  worker con FakeWorker + integración). El arnés de DOM falso se extrajo a
  `tests/helpers.mjs` compartido.
- **ProGuard/R8 blindado** (`app/proguard-rules.pro`): reglas explícitas para que habilitar
  minify algún día no rompa nada — métodos `@JavascriptInterface` de cualquier clase,
  métodos `native` de `com.kiu.agent.**` (contrato JNI por nombre), `KiuStream.onToken`
  (el C++ lo busca con `FindClass` + `GetStaticMethodID`), Vosk/JNA y el paquete completo
  del agente como red de seguridad documentada.
- **CI en orden y con herramientas propias**: `.github/workflows/build.yml` corregido (el
  filtro `branches:` tenía un YAML roto desde la tanda 6) y ahora garantiza el orden
  **tests → get-tools.sh → vendor_llama.sh → APK firmado** (`needs: tests`); el job de tests
  corre `node --test tests/*.test.mjs` (los tests nuevos entran solos). **`scripts/get-tools.sh`
  (nuevo)**: provisiona JDK 17, cmdline-tools, platform 34, build-tools, NDK 27.0.12077973 y
  cmake 3.22.1 de forma idempotente — el mismo flujo en CI y en local.

## [2.6.1] — Tanda 7: limpieza de recursos gráficos + gestión de nativos JNI

### Limpieza de recursos gráficos (APK más liviano)
- **Iconos adaptativos sin duplicados**: en las 5 densidades (`mipmap-mdpi` … `mipmap-xxxhdpi`)
  convivían dos pares idénticos en nombres distintos: `ic_launcher_bg.png`/`ic_launcher_fg.png`
  (nombres de apktool) y `ic_launcher_background.png`/`ic_launcher_foreground.png` (los que
  referencian `mipmap-anydpi-v26/ic_launcher.xml` e `ic_launcher_round.xml`). Borrado el par
  **no usado** (`bg`/`fg`) en las 5 densidades: 10 PNG, −432 KB. También salió el color huérfano
  `ic_launcher_bg` (`colors.xml` completa: solo contenía eso y no había ninguna `@color/` local
  en uso).
- **Logos del WebView en WebP**: `logo.png`, `logo_full.png` y `logo_round.png` (512×512 RGBA,
  915 KB en total) convertidos a WebP con pérdida (`quality=82`, `method=6`): **56 KB** en total
  (−94 %), misma dimensión y alfa. Los PNG no tenían ninguna referencia en el código (la esquina
  y el "Acerca de" muestran el bot SVG desde v2.3.0); quedan como activos de marca. Pautas
  documentadas en `docs/AVATAR_Y_LOGO.md` (sección "Logo en WebP").

### Librerías nativas C++/JNI (llama.cpp)
- **`.so` fuera de Git**: `app/lib/arm64-v8a/` (libllama, libggml*, libkiullama, libc++_shared —
  6,9 MB) salió del repositorio vía `.gitignore`. Los binarios viven ahora en la ubicación
  estándar `app/src/main/jniLibs/<ABI>/`, también ignorada: el build los regenera desde fuente
  o se reutilizan de un build previo. `keystore/` también queda ignorado (la clave de firma
  nunca debe subirse). El ZIP de entrega ya no incluye binarios.
- **Inyección nativa automatizada en Gradle**:
  - `app/src/main/cpp/CMakeLists.txt` fija `CMAKE_LIBRARY_OUTPUT_DIRECTORY` a
    `app/src/main/jniLibs/${ANDROID_ABI}` (antes de `add_subdirectory`, para que ggml/llama
    hereden): los `.so` compilados quedan inyectados en esa carpeta.
  - `app/build.gradle.kts`: el hack `jniLibs.srcDir(app/lib)` desapareció (ubicación estándar);
    en modo fuente se desactiva `jniLibs` como origen para no empaquetar cada librería dos veces;
    `abiFilters` automáticos según las ABIs presentes (prebuilt = solo arm64-v8a, así el APK no
    arrastra las ABIs inútiles de Vosk/JNA); si no hay vendor ni `.so`, el build corta temprano
    con la receta de recuperación en vez de producir un APK mudo.
  - `scripts/vendor_llama.sh` migra las `.so` viejas de `app/lib/` a `jniLibs` y anuncia el
    flujo; `scripts/build.sh` rechaza compilar sin motor; el CI vendoriza llama.cpp antes del
    `assembleDebug/Release` (los runner ya traen NDK y AGP instala el 27 si falta).
- **Auditoría del ciclo de vida de memoria**:
  - C++ (`kiullama_jni.cpp`) verificado sin fugas: `free_locked()` suelta contexto y modelo
    (idempotente, bajo `g_mtx`), los caminos de error de `loadModel` liberan lo cargado y
    `generate()` libera batch, sampler y buffer de un token en todos sus caminos (los `return`
    tempranos son anteriores a las asignaciones). `stream_push` limpia sus refs locales.
  - Java: nuevo `KiuGenJob.freeAsync()` (stopGen + freeModel en hilo propio, no bloquea al
    hilo que destruye el componente). `MainActivity.onDestroy()` lo llama si `isFinishing()`
    (el cierre real libera el GGUF de la RAM; la rotación mantiene el modelo cargado) y
    `KiuService.onDestroy()` lo llama solo si `MainActivity.inst == null` (sistema mató el
    servicio sin UI; con `stopWake` desde Ajustes el modelo sigue en uso por el chat).

### Misc
- Versión `2.6.1` (versionCode 35) en Gradle y UI (perfil, Acerca de, export).
- CI: el job `build` ahora ejecuta `./scripts/vendor_llama.sh` antes de Gradle.

## [2.6.0] — Tanda 6: migración apktool → Gradle completada

### Retirada total de la estructura de reempaquetado
- **Java migrado y verificado**: las clases viven en `app/src/main/java/com/kiu/agent/` y
  `reference-java/` se eliminó (la `R.java` vieja no se portó: Gradle genera su propia R).
- **Sin smali**: verificada la paridad de `KiuImport.smali` contra `KiuImport.java` (ver abajo)
  y eliminados `app/smali/` y `app/smali_classes2/` (~500 KB de bytecode descompilado).
- **Recursos unificados**: las definiciones de `app/res/values/` se integraron en
  `app/src/main/res/values/` (AppTheme completa con `colorPrimary/colorPrimaryDark/colorAccent/
  windowLightStatusBar` + `colors.xml` con `ic_launcher_bg`); `public.xml` (mapa de IDs de
  apktool) no tiene sentido en Gradle y se borró junto con toda `app/res/` (los mipmaps ya eran
  idénticos a los de `src/main/res`).
- **Manifest y assets consolidados**: `app/AndroidManifest.xml` viejo eliminado (el de
  `src/main` ya tenía TODOS los permisos, las 22 queries y los 5 componentes, y además la red
  segura con `networkSecurityConfig`); `app/assets/www/` ahora vive en
  `app/src/main/assets/www/` (ubicación estándar, sin `sourceSets` extra).
- **Scripts de reempaquetado fuera**: eliminados `app/apktool.yml`, `scripts/repack.py` y
  `scripts/get-tools.sh` (apktool + uber-apk-signer ya no hacen falta).
- **`scripts/build.sh` reescrito**: compila directo con `./gradlew` (debug por defecto;
  `KIU_PASS=… ./scripts/build.sh` = release firmado, crea `keystore/kiu-release.jks` si no
  existe). La firma v2/v3 la hace Gradle con el nuevo `signingConfig` (variables `KIU_KS`,
  `KIU_ALIAS`, `KIU_PASS`) — reemplaza al uber-apk-signer.
- **CI simplificado**: un solo flujo de build (Gradle): `tests` + `build`
  (`assembleDebug` + `assembleRelease` + lint) + `release` por tags `v*`. Con los secretos
  `KIU_KEYSTORE_BASE64`/`KIU_KEYSTORE_PASSWORD` el release sale firmado con la clave real.

### KiuImport: paridad completa con el bytecode original
- `KiuImport.java` conservaba todas sus mejoras (progreso, SHA-256) pero le faltaban tres
  validaciones del smali original: ahora rechaza archivos que no terminan en `.gguf`,
  sanitiza el nombre con la regex estricta `[^A-Za-z0-9._-]` → `_` (tope 90 caracteres) y
  verifica espacio libre (`getUsableSpace() < total + 50 MB` → "no hay espacio suficiente
  en el telefono").
- Además recupera el comportamiento del original de escribir a `<nombre>.part` y renombrar
  al final (nada de GGUF corruptos con nombre definitivo si la copia se corta), y borra el
  `.part` si algo falla. El fallback de nombre vuelve a ser `modelo.gguf` y los errores usan
  el formato del original (`ClaseSimple: mensaje`).

### Docs y versiones
- README, `docs/GRADLE_MIGRATION.md` (estado "completada al 100 %" + nueva sección de firma),
  `docs/KNOWN_ISSUES.md` (2 resueltas nuevas), `docs/BRIDGE_API.md` y `docs/AVATAR_Y_LOGO.md`
  sin referencias al flujo viejo; `.gitignore` actualizado.
- App **v2.6.0** (versionCode 34). Suite de 50 tests sin cambios (no toca código JS de lógica).

## [2.5.0] — Tanda 5: sección 4 (funciones nuevas)

### Sección 4-a — Skills instalables
- **js/skills.js** (`window.KiuSkills`): un skill es un **manifest JSON declarativo**
  (id, name, version, desc, 1–8 intents, reply con variables, tts opcional).
  **Sin código ejecutable por diseño**: no hay `eval` ni JS de terceros en el WebView,
  así los skills no pueden hacer nada fuera de contestar.
- Intents por frase (match normalizado: tildes/ñ/mayúsculas) o `regex:` explícito.
  Variables en las respuestas: `{nombre} {hora} {fecha} {bateria} {carga}`.
  También admite `reply: "accion:enciende la linterna"` para delegar en el cerebro
  local; si el cerebro no puede, el skill se calla (no contesta basura).
- Instalación: pegando el JSON en Ajustes → Skills, o **desde archivo vía SAF**
  (`kiuSkillImport` → código 7104 → `window.kiuSkillInstall`). Tope 20 skills × 8 KB.
  Re-instalar la misma id actualiza. Ejemplos incorporados: Saludo ninja, Ánimo flash
  y Estado express (botón «Ejemplos»).
- En el chat los skills **tienen prioridad sobre el cerebro** (el usuario los creó
  para personalizarlo). En Ajustes → Skills: activar/pausar/borrar uno por uno.
- Viajan en la copia completa (`skills` en el payload; los ejemplos no viajan).

### Sección 4-b — Resumen matutino
- **MorningReceiver.java**: alarma diaria (AlarmManager exacto si hay permiso, con
  reagenda automática al día siguiente y al reiniciar vía BootReceiver) que arma un
  resumen con datos **frescos al disparar**: saludo por hora, fecha en español,
  recordatorios de las próximas 36 h (de `Alarms`), batería y un tip rotativo.
  Notificación con BigText en canal propio `kiu_morning` (importancia default, sin
  estruendo de alarma). Si la app está abierta, además queda en el chat vía
  `window.kiuMorningSummary`.
- Puente: `kiuMorningSet(hora, minuto, on)` y `kiuMorningGet()`. UI: Ajustes →
  **Resumen matutino** (toggle + hora, default 08:00) con subtítulo vivo en la fila.

### Sección 4-c — Bucle ReAct de pocos pasos
- **js/react.js** (`window.KiuReAct`): si el pedido tiene varias partes («poné alarma
  a las 7 y buscá en mis notas la receta»), se parte en pasos y corre un mini-bucle
  **Razonar → Actuar → Observar** por paso con las herramientas LOCALES: el cerebro
  (alarmas, linterna, cálculo, hora, batería…) y el RAG (documentos indexados).
  Sin nube y sin modelo cargado: corre siempre. Máx 4 pasos.
- **Honestidad ante todo**: si ninguna parte se puede resolver, devuelve
  `handled:false` y el flujo normal (orquestador/API/local) sigue como si nada; si
  sobran partes sin resolver, lo dice al pie. Traza del último bucle en
  `KiuReAct.lastTrace`.
- Integrado en `sendMsg` después del cerebro y antes del orquestador (no secuestra
  búsquedas web).

### De paso (bug real)
- **PendingIntents sin `FLAG_IMMUTABLE`** en `Alarms.pending()` y
  `ReminderReceiver.notify()`: en Android 12+ con target 34 lanzaban excepción y
  **rompían TODAS las alarmas** en teléfonos modernos. Corregido (también aplica al
  resumen matutino, que usa la misma infraestructura).

### Tests y release
- `tests/skills.test.mjs` (9) y `tests/react.test.mjs` (8): validación estricta del
  manifest, match normalizado, variables, toggle, ejemplos, export/import, partición
  de pasos, clasificación, bucle completo, tope y honestidad. **Suite: 50 tests**
  (13 brain + 8 secure + 8 rag + 4 boot + 9 skills + 8 react), todos en CI.
- App **v2.5.0** (versionCode 33).

## [Sin liberar] — Tanda 4: sección 3 (arquitectura) + pendientes de la 1

### Sección 3-a — app.js dividido en módulos
- **5.457 líneas → 6 módulos** bajo `js/app/`: `env.js` (helpers, iconos, puente),
  `state.js` (ajustes, conversaciones, bóveda Sec, proveedores), `catalog.js`
  (catálogo de modelos), `models.js` (descargas + importar GGUF), `motor.js`
  (motor llama.cpp, compresión, router, orquestador, KB) y `app-ui.js` (toda la UI).
  Scripts clásicos con símbolos compartidos por `window` (mismo contrato que dentro
  del `app.js` original) para no exigir WebView con módulos ES. `index.html` carga
  los 6 en orden; el `app.js` monolítico se eliminó (queda en git).
- **Bug de antigua data corregido de paso**: `window.App` nunca se asignaba y `rag.js`
  usaba `App.toast` pelado; ahora `app-ui.js` expone `window.App`.
- **Arnés de regresión permanente**: `tests/boot.test.mjs` carga TODOS los scripts en
  el orden real de `index.html` dentro de una VM con DOM falso y verifica que no haya
  `ReferenceError` cross-módulo y que `App.init()` complete.

### Sección 3-b — RAG sobre IndexedDB + BM25
- **rag.js v3**: persistencia en IndexedDB (`kiu-rag`: docs/chunks/meta) con fallback
  automático a localStorage si no hay IDB. El tope sube de 0,8 MB a **~8 MB** de texto.
- **tf precalculado al indexar** (antes se re-tokenizaba todo el corpus en cada
  arranque) y ranking **BM25** (k1=1,4 · b=0,75) con IDF del corpus propio.
- **Migración única**: el `nexo_rag` viejo de localStorage se importa a IDB en el
  primer arranque y se borra la clave vieja. API pública intacta
  (`RAG.on/docs/search/addFile/del/toggle/stats/render/init`) + `exportAll/importAll`
  para la copia de seguridad.
- Tests: `tests/rag.test.mjs` (8, con shim de IndexedDB en memoria): migración,
  persistencia entre boots, ranking, tope, export/import, borrado en IDB, on/off
  persistente y modo localStorage.

### Sección 3-c — i18n y protección térmica
- **Fundación i18n** (`js/i18n.js`): diccionario es/en para el chrome (navegación,
  inicio, etiquetas de ajustes, botones) vía `data-i18n`; selector Español/English en
  Apariencia; guarda en `nexo_settings.lang` y dispara `kiu-lang`. Las respuestas del
  cerebro siguen en español (el texto dinámico sin clave hace fallback a español).
- **Protección térmica**: la temperatura de batería ya venía en `sysInfo().temp`;
  `Kiu._thermArm()` mide cada 10 s durante la generación y a **46 °C** corta el motor,
  entrega el parcial como respuesta recuperada y avisa (avatar "Detenido" + toast).
  Interruptor "Protección térmica" en Ajustes (`S.thermal`, por defecto activa).

### Pendientes de la sección 1 — SHA-256 y copia completa SAF
- **SHA-256 de modelos**: `KiuDlTask` hashea en streaming (incluye el `.part` previo
  al reanudar) y verifica contra el hash oficial de Hugging Face que ahora trae el
  catálogo (13/13 obtenidos de la API de HF). Si el hash no coincide, el archivo se
  borra y queda el error de siempre. El toast de fin de descarga dice
  "SHA-256 verificado ✓" y `S.dl.done[name].sha/.v` guardan el resultado. `KiuImport`
  también calcula el SHA del GGUF importado (visibles en `impStatus.sha256`).
- **Copia completa vía SAF**: nuevos métodos del puente `kiuDataExport(json)`
  (ACTION_CREATE_DOCUMENT, `kiu-copia-YYYYMMDD-HHmm.json`) y `kiuDataImport()`
  (ACTION_OPEN_DOCUMENT → `window.kiuDataRestore`). La copia incluye ajustes (sin
  claves API: nunca viajan), memoria, conversaciones, alarmas, KB, uso y RAG completo
  (documentos + fragmentos). Botones "Guardar copia completa" / "Restaurar archivo"
  en Copias de seguridad.
- `versionName 2.4.0` (versionCode 32).

### CI / tests
- Suite: 33 tests (13 brain + 8 secure + 8 rag + 4 boot). CI corriendo los 4 archivos.

## [2.3.0] — Tanda 3: sección 2 (seguridad) + avatar en la esquina

### Esquina del home
- **Fuera el bot viejo de la esquina superior izquierda**: el topbar del inicio y el bloque
  "Acerca de" ya no muestran `img/logo.png`; ahora ahí vive el mismo bot nuevo de 37 estados
  (`data-avatar-mini`, montado por `kiu-avatar-boot.js` a 36/42 px, reacciona a los estados
  como el resto). Versiones viejas actualizadas: perfil `v1.7.4` → `v2.3.0`, Acerca de
  `2.1.2` → `2.3.0`, export de datos `1.7.4` → `2.3.0`.

### Sección 2 — Seguridad
- **2-a WebViewAssetLoader**: la UI se sirve por `https://appassets.androidplatform.net`
  (origen seguro de `androidx.webkit`) en vez de `file:///android_asset`. Se apagó
  `setAllowUniversalAccessFromFileURLs` (ya no hace falta) y las navegaciones `file://` se
  bloquean. **Ferry único de datos**: el primer arranque de la app nueva carga una vez el
  origen viejo con `?ferry=1`, `js/kiu-migrate.js` exporta todo el `localStorage`, Java lo
  guarda (`kiuFerryPut`) y recarga en el origen seguro, donde el mismo script reimporta
  (`kiuFerryGet` / `kiuFerryClear`) y marca `kiu_ferried`. Sin puente (desktop) es no-op.
  Mixed-content en modo compatibilidad para los endpoints locales.
- **2-b Claves fuera del WebView**: nueva bóveda en Java (`kiuKeysSet/Get/Has/Del/List`)
  que guarda las claves API **cifradas con Keystore** (`KiuCrypto`, prefs `kiu_keys`); el JS
  nunca recibe la clave en claro (solo últimos 4). `app.js` ahora guarda por la bóveda
  (`setProvKey`/`loadKeys` migran lo viejo) y `provHeaders()` manda el placeholder
  `{{key:proveedor}}`. Nuevo `KiuApiProxy.java`: proxy HTTP(S) en Java (`kiuApiStart/Poll/Stop`)
  con HTTPS obligatorio para la nube, `http://` solo para localhost/LAN privada, tope de 8 MB,
  timeouts y cancelación. `js/kiu-secure.js` intercepta `fetch`: nube + `http://` local van por
  el proxy (sin mixed-content y sin CORS con Ollama/LM Studio), el resto pasa nativo.
- **2-c Streaming real por push**: el wrapper JNI (`kiullama_jni.cpp`) avisa cada ~300 ms / 16
  tokens vía `KiuStream.onToken` → `KiuJsPost` → `window.kiuPush('gen',{so:…})`; `app.js` pinta
  el parcial al instante y **suspende el sondeo** de `kiuGenStatus` mientras el push está vivo
  (si el push se corta, vuelve el sondeo y el watchdog de siempre). Con las `.so` precompiladas
  no hay push y todo sigue como antes: cero rupturas.

### CI / tests
- `tests/secure.test.mjs` (8 tests nuevos): bóveda por puente, routing del fetch (local/nube/
  fuera de lista/transparente sin puente) y ferry completo. CI: `node --test tests/*.test.mjs`.
- `versionName 2.3.0` (versionCode 31), dependencia nueva `androidx.webkit:webkit:1.11.0`.

## [Sin liberar] — Tanda 1: migración Gradle + motor desde fuente + wake word

### Sección 5 — Apuestas grandes (de la lista de mejoras)
- **5-a Proyecto Gradle real**: `settings.gradle.kts`, `build.gradle.kts` raíz, `app/build.gradle.kts`
  (AGP 8.5.2, minSdk 24 / target 34, namespace `com.kiu.agent`), wrapper 8.9, manifest limpio y
  recursos mínimos. Los 12 fuentes Java de `reference-java` quedaron porteado a
  `app/src/main/java/com/kiu/agent/` (verificado compilando con ECJ + android.jar platform-34).
  Tres métodos que el decompilador no recuperó se reescribieron a mano:
  - `KiuDlTask.run()` — **con reanudación HTTP Range** (las descargas de modelos retoman donde
    quedaron).
  - `Bridge.contacts()` — idéntico al bytecode original.
  - `KiuImport.copy()` — copia SAF con progreso.
- **5-b Motor nativo desde fuente**: `vendor/llama.cpp` (commit `b476d9a`, shallow) +
  `app/src/main/cpp/kiullama_jni.cpp`, un wrapper JNI que implementa el contrato exacto de
  `KiuNative` (loadModel/generate/genStatus/stopGen/freeModel…) con la API actual de llama.cpp
  (batches, context shift, sampler chain, prefill por lotes de 512). El `app/build.gradle.kts`
  detecta solo el modo: con `vendor/llama.cpp` compila con NDK, sin él usa las `.so` precompiladas.
  Para vendorizar: `./scripts/vendor_llama.sh`.
- **5-c Wake word local offline**: `WakeWordEngine.java` basada en Vosk (modelo pequeño en español),
  loop propio de `AudioRecord` a 16 kHz, gramática `["kiu","hey kiu","iu","ki"]`, cooldown 4 s y
  silencio automático mientras el TTS habla. Integrada a `MainActivity` y al bridge JS
  (`kiuWWStart` / `kiuWWStop` / `kiuWWState`).

### Sección 1 — Rápidas
- **LICENSE**: agregada licencia MIT.
- **Tests**: `tests/brain.test.mjs` con 13 tests (Node puro, `node --test`) cubriendo `norm`,
  `parseWhen`, `reply` matemática, `genPass`, `fallback` y anti-falsos-positivos. Corren en CI.
- **Release por tags**: el workflow de GitHub Actions ahora, al pushear `v*`, publica una Release
  con los APK de ambos flujos (apktool y Gradle).
- **network_security_config.xml**: en el build Gradle el tráfico en claro está bloqueado por
  defecto (HTTPS obligatorio); solo localhost, 127.0.0.1 y 10.0.2.2 tienen excepción, y hay un
  bloque comentado para agregar IPs LAN (Ollama / LM Studio). ⚠️ Si usás el motor de otra máquina
  por HTTP, agregá su IP a `app/src/main/res/xml/network_security_config.xml`.

### CI
- Job nuevo `tests` (Node 20) + job `release` (publica en GitHub Releases).
- Se conservan los dos jobs de build: `build` (apktool, respaldo) y `gradle` (real).

### Documentación
- `docs/GRADLE_MIGRATION.md` (nueva), `docs/KNOWN_ISSUES.md` (sección "Resueltas"),
  `docs/BRIDGE_API.md` (wake word), `README.md` (dos caminos de build), `CHANGELOG.md` (este archivo).

## [Sin liberar] — Tanda 2: avatar nuevo de 37 estados en toda la app

### Avatar
- **Activado el bot nuevo** (`kiu-avatar.js`, 37 estados con paletas, ojos, bocas,
  brazos, antena y objetos FX): `index.html` ya no carga el robot viejo
  (`avatar.js` queda como referencia).
- **En los tres huecos**: hero, cabecera del chat y tarjeta de perfil, cada uno con
  el tamaño del hueco real y re-ajuste automático en resize.
- **Estados automáticos**: el boot envuelve `KiuBridge` y refleja escuchar, hablar,
  wake word ("Palabra de activación"), generar/listo, detener, cargar/liberar modelo,
  descargar (con error/éxito), importar, recordatorios, temporizadores, manos libres
  y acciones de dispositivo.
- **Capa de compatibilidad**: `app.js`/`tools.js`/`brain.js` siguen llamando la API
  vieja (`set('work')`, `flash('error')`, `state()==='speak'`, `pick(texto)`,
  `mount()`) y se traduce al mapa nuevo — cero cambios invasivos en app.js.
- **RAG conectado**: indexar un documento muestra "Indexando" y luego "RAG activo";
  apagar RAG muestra "RAG apagado".
- Mapa interactivo: `docs/kiu-estados.html`.

## v2.7.1 — revisión de errores (post tanda 8)
- **Seguridad** `MainActivity.jsStr`: el escape manual dejaba `\\"` (cerraba el string JS). Con `MainActivity`
  exported, el extra `cmd` de un Intent permitía inyectar JS con acceso a `KiuBridge`. Ahora usa `JSONObject.quote`.
- **Seguridad** `KiuApiProxy.allowed()`: `http://10.evil.com` / `192.168.evil.com` pasaban como LAN. Ahora IPv4 literal real.
- **Seguridad** `KiuApiProxy`: las redirecciones reenviaban `Authorization` a otro host. Ahora se siguen a mano (máx 3),
  se revalida cada destino y la clave `{{key:}}` no se envía si cambia el host.
- **Compilación** `KiuApiProxy`: `JSONObject.opt(name, "")` no existe en Android → `optString`.
- **Recordatorios** `brain.parseWhen`: "9 de la mañana" daba *mañana*; "12 de la noche" = mediodía; "esta noche a las 10" = 10:00;
  "1 hora y media" = 1 hora; "9 menos cuarto" = 9:00; "en media hora" no se entendía.
- **UI** `timeUntil` mostraba "en 0 min"/"en 29 min" (floor → ceil). Test inestable corregido.
- **UI** botón Copiar de bloques de código copiaba entidades HTML (`&amp;&amp;`).
- Tests: 85 → 88.

## v2.7.2 — mejoras de la revisión
- **WebView**: `onPermissionRequest` ya no concede todo; solo audio y solo desde el origen propio.
- **Recordatorios**: tras reiniciar o tener la app cerrada, los vencidos hace <48 h avisan "(Perdido) …" en vez de borrarse en silencio.
- **Descargas** (`KiuDlTask`): un `.part` completo devolvía HTTP 416 y se atascaba para siempre → ahora se verifica y finaliza;
  si el servidor ignora el Range se trunca el `.part`; `path` solo se fija si el SHA-256 pasa; campos de estado `volatile`.
- **kiu-secure.js**: `fetch(new Request(...))` por el proxy conserva método, headers y body; la respuesta ahora tiene `arrayBuffer()`/`blob()`.
- **Markdown**: el código en línea se aparta antes de procesar negrita, cursiva y enlaces.
- `Alarms.cancel` sin sobreescritura inútil; User-Agent del proxy actualizado.
- Tests: 88 → 89.

## v2.7.3 — JNI, importación, wake word, notificaciones
- **JNI** `kiullama_jni.cpp`:
  - `genStatus.done` era `toks > 0` (true desde el 1.er token): con el push cortado >1,3 s (modelos ≤0,8 tok/s) el JS abortaba la
    generación a medias. Ahora `done` usa un flag real `g_running` (RAII en `generate`).
  - `NewStringUTF` con UTF-8 parcial/emojis de 4 bytes (modified-UTF-8 inválido → abort con CheckJNI / texto corrupto): helper
    `mk_jstring` recorta la cola incompleta y construye el String por bytes.
  - Con `n_predict` ≥ ~ctx el prompt se recortaba a 16 tokens: la reserva para la respuesta se limita a ctx/4.
  - El context shift conservaba solo 16 tokens (perdía el system prompt): ahora conserva hasta 256 (¼ de la posición).
  - Piezas de token >192 bytes se perdían (`n<0`): se reintenta con buffer mayor.
- **KiuImport**: valida magic GGUF, cierra+sync antes de renombrar, borra el `.part` si falla, `begin()` atómico (doble toque).
- **KiuService (wake word)**: el comando se entregaba con el resultado *parcial* (truncado) y otra vez con el final → doble ejecución.
  Ahora solo actúa con el final; `wakeDeliver` tiene antirrebote de 4 s. Reinicio tras swipe con `getForegroundService` (Android 8+).
- **MorningReceiver** usaba el ID 2001 de la notificación fija del servicio de voz y la pisaba → ahora 2002.
- **BootReceiver** también atiende `MY_PACKAGE_REPLACED` (actualizar la app borra las alarmas) y `TIME_SET`/`TIMEZONE_CHANGED`.
- **Contraseñas**: `genPass(len, noSymbols)`; sin símbolos la clave salía más corta (índice 0–26 sobre 24 letras) y con `Math.random()`.
- Tests: 89 → 90.

## v2.7.4 — ideas pendientes
- **Seguridad del prompt**: `Kiu.defang()` neutraliza tokens de control (`<|im_start|>`, `<start_of_turn>`, `[INST]`, `<s>`…) en el
  contenido de usuario/RAG/web; las plantillas de `fmt()` quedan intactas. El tokenizador usa `parse_special=true`, así que antes
  un documento o una web podía abrir turnos "system" falsos.
- **Sampler**: penalización de repetición (últimos 64 tokens, ×1.1). *Verificar la firma de 4 argumentos contra tu `vendor/llama.cpp`.*
- **RAM**: `loadModel` estima el KV cache y baja el contexto (mitades, mínimo 512) si no entra en `MemAvailable`; `loadProgress` incluye `ctx`.
- **Importación cancelable**: `importCancel()` (puente) + toque en el estado "Importando…" con confirmación; borra el `.part`.
- **RAG**: notas de ≥12 caracteres (antes 40) y ids de documento únicos (dos archivos en el mismo ms chocaban).
- **Calculadora**: `%` es porcentaje (`200+10%`=220, `50%`=0,5) en lugar de módulo. `KiuTools.calcEval` expuesto para tests.
- Tests: 90 → 93 (nuevo `tools.test.mjs`).
