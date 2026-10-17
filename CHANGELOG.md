# Changelog

Formato basado en Keep a Changelog. Fechas en 2026.

## [2.9.8] — El modelo de voz se instala desde la app

Hasta ahora, tener la palabra de activación local era saber un comando de `adb`.
El modelo son 39 MB, no puede ir en el repo, y **no había ninguna pantalla para
bajarlo**: prendías el micrófono, no pasaba nada, y nada en la app decía por qué.
La fila del diagnóstico de voz decía «sin modelo» y se quedaba ahí.

### El flujo

Tres llamadas, no una, porque son tres estados que fallan distinto:

| | qué hace | puede fallar por |
|---|---|---|
| `wwInstall()` | arranca la descarga | red, espacio, SHA |
| `wwUnzip(path)` | descomprime | el zip bajó corrupto |
| `wwUnzipStatus(id)` | reporta progreso | — |

La descarga reusa `KiuDownload`, que ya tenía reanudación, SHA-256 y verificación.

### El detalle que casi se pierde

El zip oficial trae todo dentro de `vosk-model-small-es-0.42/`:

```
vosk-model-small-es-0.42/am/final.mdl      <-- el modelo
vosk-model-small-es-0.42/conf/mfcc.conf
vosk-model-small-es-0.42/graph/Gr.fst
```

Descomprimirlo tal cual debajo de `models/vosk-es-small/` deja el modelo en
`models/vosk-es-small/vosk-model-small-es-0.42/am/final.mdl`, y el motor busca
`models/vosk-es-small/am/final.mdl`. **Un nivel de diferencia.** Y el síntoma es el
peor de todos: el modelo pesa 60 MB en disco, la app dice «falta el modelo» para
siempre, y bajar el zip de nuevo no arregla nada porque el bug no es la descarga.

`ZipInstall` quita la carpeta raíz, y la aprende de la primera entrada del zip en
vez de hardcodearla: si upstream renombra la carpeta, la instalación sigue
funcionando. Antes de decir «listo» comprueba que `am/final.mdl` quedó donde
corresponde — **instalar y que no sirva es peor que no instalar.**

### Zip-slip

Cada ruta se canonicaliza contra el destino y tiene que empezar por él. Un nombre
con `../` escribiría fuera de la carpeta de la app, que en Android es el filesystem
entero. No es paranoia: un zip renombrado de ahí viene. Las entradas sospechosas se
cortan y se cuentan; no abortan, porque un modelo puede traer basura y servir igual.

### Y se prueba con el zip de verdad

`VoskZipHarness` **descomprime los 39 MB reales** y mira dónde quedaron. Es el test
que un test de forma no puede hacer: el código puede estar impecable y el resultado
ser inútil.

El SHA queda fijado en el código (`09b23988…`): son 39 MB que van directo al disco de
la app y de ahí a Vosk, y una descarga sin verificar es una puerta abierta.

**Suite: 244 → 250 tests** (250 con JDK y el zip; 247 + 3 saltados sin ninguno de
los dos).

## [2.9.7] — Tests de Java que se EJECUTAN, no que se leen

`Backoff` es Java puro: cero imports de Android. Eso estaba escrito en su
documentación, pero los tests no lo aprovechaban — lo verificaban **leyendo el
fuente con regex**:

```js
assert.match(boC, /Math\.min\(maxMs, esperaMs \* 2\)/, 'la espera dobla con techo');
```

Eso comprueba que el código **diga** esa expresión. No que **haga** lo correcto. Un
`Backoff` reescrito a mano con la misma expresión textual y un `if` mal puesto
pasaría el test igual: el texto está, la conducta no.

### Qué cambió

`tests/java/com/kiu/agent/BackoffHarness.java` + `tests/java.test.mjs` compilan la
clase con `javac` y la **ejecutan**. Once aserciones de comportamiento en vez de seis
de forma:

- la espera no decrece entre intentos, y no pasa del tope
- agotados los intentos devuelve **−1**, y es estable (un 0 acá produce un
  reintento instantáneo y trabado en el hilo de audio: el peor resultado posible)
- `reset()` devuelve exactamente el primer intento
- una base negativa o un tope 0 se normalizan a algo **mayor que 0**
- `Backoff` no guarda estado de error: eso es del subsistema que lo usa, y que el
  test lo verifique evita el error opuesto — dos capas peleando por él

### El arnés se prueba a sí mismo

`el arnés detecta sus propios fallos` compila un `Backoff` **deliberadamente roto** —
misma forma textual, peor comportamiento (la espera nunca decrece, se rinde antes de
tiempo) — y exige que el arnés **falle**. Sin ese test, un arnés que no ejecutara nada
pasaría en verde sobre una clase rota, que es el peor resultado posible.

Y en el camino apareció un fallo **mío**, que es la clase de error que este tipo de
test existe para cazar:

```java
check(b.siguiente() == primero, "... no " + b.siguiente());
```

Los argumentos de un `assert` se evalúan **siempre**, incluso cuando la aserción
pasa. Ese `siguiente()` del mensaje consumía un intento extra y el contador llegaba
a 2: el test fallaba por su propio texto de error. Con la forma escrita a mano
(`long trasReset = b.siguiente()`) se lee bien y no tiene el problema.

### Sin JDK no pasa: se salta, y a la vista

El runner de GitHub ya trae un JDK, así que **en el CI esto corre siempre**. Local,
si no hay JDK los dos tests se marcan `SKIP sin JDK (javac no encontrado)` — nunca
verde en silencio. Un test que no llegó a correr no puede reportarse como
correcto, y en este proyecto esa confusión ya costó una tanda entera.

Por eso tampoco usa JUnit: `app/src/test` con JUnit exige el SDK de Android para
correr, así que no correría en ningún lado donde no haya SDK. Con `javac` + `java`
sobre clases puras corre en cualquier máquina con JDK.

**Suite: 240 → 244 tests** (244 con JDK, 242 + 2 saltados sin él).

## [2.9.6] — Los tres fallos de voz, arreglados

Todos estaban en la capa Java, que hasta ahora no tenía **ni un test**: 4.900
líneas sin cobertura, y la suite de 227 tests en verde mirándola fijamente.

### 1 · Una llamada mataba la palabra de activación para siempre

`WakeWordEngine.run()`: cuando `AudioRecord.read()` devolvía un error
(`ERROR_DEAD_OBJECT` — el mic lo toma una llamada o otra app), el código ponía el
mensaje y hacía `continue` **sobre el mismo AudioRecord**. Un AudioRecord en
estado de error no se recupera: hay que `stop()`/`release()` y crear otro.
Seguir leyendo del mismo devuelve el error para siempre.

Atendías un teléfono, cortabas, y Kiu no escuchaba más hasta que lo apagabas y lo
volvías a prender a mano. Sin mensaje, sin log.

Ahora el read-loop **se corta** al primer error de micro y el loop de afuera
reconstruye el `AudioRecord` con backoff. Si no vuelve, se rinde **y lo dice**
(`running = false`) en vez de quedarse mudo fingiendo que escucha.

El read-loop pasó a ser `escucharUnaVez()`, que devuelve un estado: mic muerto,
o se paró. Con eso `run()` queda de un vistazo.

### 2 · El error quedaba pegajoso

`err` se limpiaba únicamente en `start()`. Un fallo transitorio del micro dejaba
*"micrófono ocupado"* puesto para el resto de la sesión, aunque después anduviera
perfecto. El mensaje mentía sobre el estado real.

Ahora se limpia cuando el micrófono **abre de verdad** — después de
`startRecording()`, no antes, porque limpiar antes sería mentir igual pero al revés.

### 3 · La voz podía no arrancar nunca, en silencio

`MainActivity.initTts()` se llamaba **una sola vez**, en `onCreate`. `ttsReady`
se ponía en true únicamente dentro de la rama `i == 0`. Si el motor de TTS no
estaba listo en ese instante —muy común en arranque en frío, y también cuando el
servicio de voz se instala después de la app— el init fallaba, `ttsReady` quedaba
`false` **para toda la vida de la app**, `speak()` hacía `return` en la primera
línea, y no había ni toast ni error ni reintento.

El síntoma era exactamente el reportado. Y lo peor: *"Kiu está pensando"* y
*"Kiu no tiene voz"* se ven **igual** desde afuera.

Ahora reintenta con backoff, cierra el motor anterior en cada intento (si no,
filtra uno por intento), y si de verdad no arranca lo dice por `nexoVoiceError` y
el motivo aparece en el diagnóstico de voz.

### Un bug que me metí yo

Escribiendo el arreglo del 1 colgué el `reset()` del backoff de un estado
(`LECHO_OK`) que nadie devolvía. El backoff nunca se reiniciaba, así que tras 8
micro-fallos repartidos en una sesión, Kiu se rendía para siempre — el mismo
síntoma que el bug que estaba arreglando.

Lo encontró un test. El estado sobrante no está, y hay un test que afirma que no
esté: `LECHO_OK` no puede volver a aparecer. El backoff se resetea en el único
sitio con sentido, **cuando el mic abre**: el presupuesto de reintentos es por
micrófono, no por sesión. Si una app te toma el micro un rato y lo suelta, ese
contratiempo no puede gastar los reintentos de los próximos treinta minutos.

### La brecha de cobertura, al menos medida

No puedo compilar Java acá (no hay JDK), así que estos tests son de **estructura
por análisis del fuente**: fallan si alguien revierte el arreglo, pero no
sustituyen a compilar y probar en el teléfono. Para lo segundo:

- `Backoff.java`: lógica pura, **cero imports de Android**. La política de
  reintentos de todo el audio vive ahí, y por eso se puede razonar y testear.
- `tests/java-estructura.test.mjs`: escáner de una pasada que balancea llaves y
  paréntesis de todo el Java. Es lo único de esa capa que se puede verificar sin
  compilador.
- El CI ya corre `:app:testDebugUnitTest` antes de publicar el APK. Hoy es un
  no-op que pasa, porque `app/src/test` sigue vacío; queda el cableado listo.

Un detalle del escáner que vale la pena: tiene que manejar comentarios, cadenas
y literales **en ese orden**, en una sola pasada. Un checker ingenuo que quita
comentarios después de las comillas se come el archivo entero cuando encuentra un
apóstrofe en un comentario (`don't`) — que es exactamente lo que pasó con
`MainActivity.java` durante esta tanda: reportó −1 en un archivo perfectamente
balanceado. Un checker que miente es peor que no tener ninguno, así que el test
comprueba que el escáner se rompa cuando debe.

### Suite: 227 → 240 tests**, todos en verde.

## [2.9.5] — Que no se pueda instalar un APK sin saberlo

Este es el que explica el reporte que se repitió: «la versión que se instala con
ese archivo es 2.7». Con los bugs de voz ya arreglados, la versión seguía
 appearing como 2.7, así que **no era el código: era qué APK se estaba
instalando.**

### Lo que pasaba

El ZIP que entrego es **solo código, no un APK**. Y no trae las librerías nativas
del motor: están en `.gitignore` porque son 40 MB (`app/src/main/jniLibs/` y
`vendor/llama.cpp`). El build local desde ese ZIP **falla** con «KIU: no hay
librerías nativas del motor».

Y acá está la trampa: si el build falla y se instala igual, queda el APK viejo. El
error se va al scrollback de Gradle, el APK viejo anda perfecto, y la app dice 2.7
mientras el código está en 2.9.4. **Nada avisa.** Es un bucle cómodo: builds que
fallan, instalaciones que "funcionan", y una versión que nunca cambia.

### El sello de build

Cada build ahora escribe `assets/build-stamp.json` adentro del APK: versión,
código, commit, fecha y dónde se compiló. Y hay un script que lo lee **antes de
instalar**:

```bash
./scripts/verificar-apk.sh app/build/outputs/apk/debug/app-debug.apk --esperar 2.9.4
```

Sale con 0 si es el APK que esperabas, con 1 si no. Sin Android SDK, sin `aapt`,
sin `apkanalyzer` — se lee con `unzip -p`, que es justamente cuando uno no tiene
las Android tools a mano.

La versión se declara **una sola vez** en `build.gradle.kts`. Estaba en dos lugares
(`defaultConfig` y el sello), y con dos lugares donde poner un número aparece el que
se queda viejo — y el que se queda viejo sería el sello, que es el que dice qué
estás por instalar. Mentiría con autoridad.

### Dos casos donde el script NO dice que todo bien

- **Sin sello y con `--esperar` → falla.** Un APK sin sello es anterior a esta
  tanda o fue reempaquetado; no se puede saber qué es. *No poder confirmar* no es
  *estar bien*, y si el script saliera con 0 estaría aprobando algo de lo que no
  sabe nada.
- **APK sin `.so` → lo dice y lo marca.** Se puede instalar, no puede generar, y
  eso es peor que no instalar.

También se arregló el parseo de argumentos, que usaba `for arg in "$@"`: esa forma
congela la lista de argumentos al empezar, así que el `shift` del `--esperar` no
surtaba efecto y el valor se tomaba como nombre de archivo. El script "funcionaba"
y pedía un archivo que no era. Con `while` + `shift`.

**Suite: 219 → 227 tests**, todos en verde.

### La salida, entonces

**Bajá el APK del release de GitHub** y verificalo antes de instalarlo. El CI ya
publica `Kiu-APK-release`; así no dependés de que tu build local funcione, que es
justo donde estaba fallando.

## [2.9.4] — La voz: dos bugs reales y un diagnóstico que las distingue

Reporte: «la versión que se instala es 2.7, el audio no funciona, no me reconoce
la voz ni activa por reconocimiento de voz». Salieron **dos bugs reales** y una
decisión de diseño que estaba produciendo exactamente ese silencio.

### 1 · BUG: el modelo local se buscaba en el lugar equivocado

Este es el grande. El modelo oficial `vosk-model-small-es-0.42` tiene esta
estructura:

```
vosk-model-small-es-0.42/
  am/final.mdl        <-- acá está
  conf/mfcc.conf
  conf/model.conf
  graph/Gr.fst
  graph/HCLr.fst
```

y el código chequeaba `<dir>/final.mdl`, **en la raíz**. Con el modelo puesto
exactamente donde dice la documentación, ese archivo no existe → el chequeo daba
`false` → el arranque se negaba → el error que llegaba decía *«falta el modelo»*.

Eso es una mentira: el modelo estaba, en su sitio, y la app no lo veía. Y el
síntoma es justo el reportado —la palabra de activación nunca dispara— con un
mensaje que apunta al lugar equivocado, así que la respuesta obvia («bajar el
modelo») no arregla nada porque el modelo ya estaba.

Verificado contra la [estructura oficial](https://alphacephei.com/vosk/models):
V2 es `am/final.mdl`; vosk-api además acepta V1, el layout plano en la raíz. Se
aceptan **los dos**, porque alguien puede haber copiado el contenido de `am/` a
mano, y el que decide si arranca y el que informa si está tiene que mirar lo
mismo — si uno busca `am/` y el otro la raíz, uno de los dos miente igual.

### 2 · BUG: si el recognizer se colgaba, Kiu quedaba mudo para siempre

`KiuService.cycle()` rearma el bucle **solo** desde `onResults()` y `onError()`.
`cycle()` pone `listening = true` y vuelve sin reprogramar, confiando en que el
motor de voz llame a alguno de los dos.

Ese supuesto no se cumple siempre: si `startListening()` arranca y el recognizer
se queda colgado (sin red, motor que no responde, pensando en silencio), no llega
`onResults` ni `onError`. `listening` queda en `true` para siempre, `cycle()`
sigue volviendo por el `if (listening) return`, y Kiu deja de escuchar **en
silencio**: sin error, sin log, sin aviso.

Es el peor modo de falla posible para algo que se reporta como «no me reconoce la
voz», porque no hay nada que reportar. El watchdog no arregla el motor, pero
convierte un colgado infinito en un reintento con backoff que por lo menos se ve.

### 3 · La versión instalada se puede ver (y era mentira)

El rótulo del perfil decía `Kiu v2.9.3` con una **constante escrita a mano en el
JS**. Con un APK viejo no tenía por qué delatar nada — y la app instalada decía
2.7 mientras el repo ya iba por 2.9.3, sin que ninguna señal lo delatara.

Ahora la versión sale de `PackageManager`: la del **paquete realmente instalado**.

Y un matiz que costó pensar: **la app no puede auto-detectar que su APK es viejo.**
El JS y el nativo salen del mismo árbol de compilación, así que siempre coinciden
y cualquier chequeo «instalada < esperada» pasaría siempre. Un número esperado
hardcodeado en el JS sería la misma mentira de antes.

Lo que **sí** es detectable, y es el caso real, es una instalación **mezclada**:
assets viejos con nativo nuevo. Eso se reconoce por **capacidad**, no por número —
este código declara qué métodos del puente necesita, los prueba, y si falta uno
lo dice por nombre: *«falta kiuGenSetGrammar»*. Accionable, a diferencia de un
número de versión que hay que ir a buscar.

### 4 · El diagnóstico de voz

Las cuatro causas que se ven **igual** desde afuera —APK viejo, sin servicio de
reconocimiento, sin modelo local, sin permiso de micrófono— se distinguían por
adivinanza. Ahora hay un botón **Diagnosticar voz** que lee el estado real de las
cuatro y, cuando algo está mal, dice **la grilla concreta** en vez de un «algo
anda mal».

Un detalle de diseño: `verReal()` y `diagVoz()` se movieron de `app-ui.js`
(4000 líneas) a `app/diag-voz.js`, un módulo con una sola dependencia. Estaban
adentro del archivo grande y **no se podían testear**: cargar `app-ui.js` en un
arnés arrastra store, DOM y timers, y los tests pasaban sin ejercitar nada.

**Suite: 206 → 219 tests**, todos en verde.

### Lo que sigue pendiente

La palabra de activación local **sigue necesitando el modelo**, que son 39 MB y no
van en el repo. Con el bug 1 arreglado, ahora sí se lo detecta y se lo ve — pero
instalarlo sigue siendo manual por `adb`. La app no tiene todavía una pantalla para
bajarlo. Es el próximo paso natural, y es la diferencia entre «funciona» y
«funciona si sabés el comando de adb».

## [2.9.3] — La gramática llega al motor (y se forgets sola, a propósito)

En 2.9.2 el generador GBNF existía y estaba testeado, pero no tenía a quién
mandarle la gramática: el `KiuNative.generate()` no aceptaba una y no había forma de
pasársela. Esta tanda cierra el circuito.

### 1 · `setGrammar` en vez de cambiar la firma de `generate`

El camino obvio era `generate(prompt, maxT, temp, gbnf)`. Es el que **no** se hizo:
cambiar la firma de un método nativo rompe el puente JS entero (`kiuGen` lo invoca
`motor.js`) y obliga a tocar los dos lados de un puente que hoy anda.

En vez de eso hay un setter aparte. El JS pone la gramática justo antes de pedir la
decisión y el resto de la app sigue llamando `generate(prompt, maxT, temp)` sin
enterarse de que existe. Tres métodos nuevos:

| | |
|---|---|
| `setGrammar(gbnf)` | la aplica la **próxima** generación; `""` desactiva |
| `grammarPending()` | cuál espera (diagnóstico y tests) |
| `grammarOk()` | si la última se pudo aplicar |

El tercero es el que más importa, y es para una trampa concreta: **si el motor no la
aplica, la generación sale igual y sin restringir.** Un bucle que cree que la gramática
está activa y en realidad no lo está se apoya en un parse que nunca va a venir bien, y
el síntoma —"sale JSON roto"— apunta a la validación, que es la innocent. Con
`grammarOk()` el JS lo sabe y el parse + reintento deja de ser un plan B theoretical.

### 2 · La gramática se CONSUME, y eso es un test

La generate() hace `gbnf.swap(g_grammar_pending)`: la toma y la borra. Y `stopGen()` la
limpia también.

Sin esto la gramática queda pegada: el `{"tool":...}` de la última decisión del agente
sigue esperando, y la respuesta de chat que viene después de al lado sale forzada a
emitir un JSON de herramienta. No se ve como un bug de gramática — se ve como un bug de
chat, en otra pantalla, más tarde, en la conversación que no tenía nada que ver. Es
forgetting con forma de fantasma, así que está testeado en las dos vías.

### 3 · Va al final de la cadena, y con temp 0

`llama_sampler_chain_add(smpl, gs)` va **último**, después de greedy/dist. Es lo que
decide si un token se puede emitir: lo que no encaja con la gramática no existe. Si
fuera antes, los samplers de arriba verían tokens que después se rechazan.

Y con `temp > 0` hay un `dist` aleatorio justo antes. El de abajo igual manda, así que
el resultado quedaría restringido igual — pero `motor.js` manda **temp 0** cuando manda
gramática, para no depender de cuál de los dos gana el conflicto.

### 4 · El shim, otra vez

`kiu_grammar()` tiene la misma estructura de dos overloads que `kiu_penalties()`: si el
vendor no expone la firma, cae a un overload que devuelve `nullptr`, el sampler se omite
y la generación sigue **sin gramática**. Romper el APK porque upstream renombró algo no
puede ser el precio de una mejora opcional.

### Un test que pasaba por el motivo equivocado

Al testear el camino nuevo apareció un `typeof g === 'object'`. No era un bug del
producto: el arnés no definía `rawBridge` (que vive en `app/env.js` y lee
`window.KiuBridge`), el `ReferenceError` lo comía el `try/catch` del agente, y `gbnf`
quedaba `null` — y `typeof null` es `'object'`. El test pasaba antes, cuando la
asertación era la débil; con la asertación fuerte, se comió el problema.

Vale la pena dejarlo anotado porque es el patrón que más me gusta de esta tanda: **el
try/catch correcto escondió un test que no estaba probando lo que decía probar.** El
fix no fue relajar la asertación sino definir `rawBridge` en el arnés, para que la ruta
real se ejercite.

**Suite: 199 → 206 tests**, todos en verde.

**Lo que sigue sin verificar**: que el C++ compile. `kiu_grammar_impl(0, a...)` con
`a...` vacía — el overload que se elige es el `int` y `llama_sampler_init_grammar(gv,
gbnf.c_str(), "root")` es una llamada directa de 3 argumentos, que es la firma conocida.
El SFINAE hace su trabajo, pero eso solo lo confirma un compilador.

## [2.9.2] — El motor deja de flotar, y el agente deja de ser lento de arrancar

Tres cosas, en orden de importance para lo que vas a sentir en el teléfono.

### 1 · El motor nativo estaba anclado a `master`

`vendor_llama.sh` clonaba `llama.cpp` de `master` y el CI hacía lo mismo. Eso es una
dependencia flotante: un commit de upstream puede romper el build **sin que cambie nada
del repo**, y no había forma de volver atrás porque el clon local ya lo había pisado con
`reset --hard`.

No es teórico. El propio `kiullama_jni.cpp` tiene un shim por `llama_sampler_init_penalties`
porque **esa firma ya les cambió una vez**. Compilar contra `master` todos los días es
esperar el próximo.

Ahora:
- `LLAMA_TAG` + `LLAMA_SHA` (**v0.7.0**) en `vendor_llama.sh`, que es la única fuente de
  verdad; el CI la lee de ahí.
- Se trae el **tag** (una ref de verdad, se puede traer siempre) y se **verifica** que el
  commit sea el SHA esperado. Si alguien movió el tag upstream, el script para con un
  ruido en vez de compilar código distinto del que creés.
- `--show` imprime el pin y el estado local.
- El CI lo muestra en el `$GITHUB_STEP_SUMMARY`: un fallo de compilación dice contra qué
  commit fue y se puede reproducir.
- El header documenta cómo se cambia el pin — y que un cambio de API se **shimmea**, no se
  esquiva bajando el requisito.

### 2 · El prefill del agente era el 80 % del costo de una decisión

Cada decisión del agente paga el prompt entero en el prefill de la CPU del teléfono, y el
proyecto ya sabe que ahí está el cuello de botella (el comentario de PROMPT LIVIANO en
`app-ui.js` dice que el prompt grande "tardaba minutos").

| | antes | ahora |
|---|---|---|
| manifiesto | 1.565 car ≈ **435 tok** | 934 car ≈ **259 tok** |
| prompt de una decisión | 1.957 car ≈ **544 tok** | 1.263 car ≈ **351 tok** |
| salida que se pide | 120 tok | 120 tok |

**−35 % de prefill**, y además se encontró que el mensaje del usuario iba **dos veces** en
el prompt (una en `TAREA:` del system, otra como mensaje del user). Con historial, la
`TAREA:` ya no se manda: el último mensaje del usuario *es* la tarea.

Las descripciones pasaron de párrafos a disparadores ("Programar una alarma o recordatorio."
en vez de explicar cuándo usarla), y el manifiesto es una línea por herramienta. **Y hay un
techo en los tests** (`budget()`, 280 tokens de manifiesto): si alguien vuelve a escribir un
párrafo ahí, el test se pone rojo.

### 3 · Gramática GBNF derivada del mismo esquema

`KiuAgente.grammar()` genera la gramática de muestreo desde el **mismo** `args` que valida y
que documenta el prompt. No hay tres lugares que mantener: si mañana agregás un argumento,
los tres lo toman solos, y hay un test que lo verifica agregando una herramienta de mentira.

Lo que aporta, con sus límites:
- Los **ENUM** quedan enumerados: `device_action.what` no es texto libre, es una de las 8
  acciones. Y `validate()` los revisa **también**, porque la gramática no siempre está
  activa (sin JNI, o cuando la decisión va por un proveedor).
- Los opcionales generan las alternativas que existen: `set_alarm` produce la rama con
  `when` y la rama con `when`+`label`.
- **No arregla el problema de fondo.** La gramática garantiza que el JSON sea válido, no
  que la herramienta sea la correcta: un modelo puede llamar `set_alarm` cuando debía leer
  la agenda, y la gramática lo deja pasar. Para eso están la validación y la observación
  que vuelve al bucle. **Gramática = menos reintentos. Validación = menos errores.**

El generador es JS puro y está testeado entero, con un validador de GBNF chiquito (paréntesis
y comillas balanceados, raíz que menciona todas las reglas) porque llama.cpp tira excepción
si la gramática está mal formada y eso no se ve hasta el build.

**Lo que falta para usarla**: el pegamento JNI (`kiuGenGrammar` +
`llama_sampler_init_grammar(vocab, texto, "root")`). Son ~40 líneas que no se pueden compilar
ni probar acá, y por eso esta tanda **no** las incluye.

**Suite: 180 → 199 tests**, todos en verde.

## [2.9.1] — Que el MODELO elija la herramienta

Hasta acá Kiu no era un agente: `brain.js` tenía ~200 regex que decidían qué era cada
pedido y el modelo solo redactaba la respuesta final. `js/kiu-agente.js` agrega el registro
de herramientas y el bucle que le pregunta al modelo qué hacer.

### El registro
```js
{ name, desc, args: { <k>: {type, required, desc} }, run(args) -> {ok, text}, risk }
```
Seis herramientas: `set_alarm`, `read_calendar`, `find_contact`, `call_contact`,
`search_docs` y `device_action`. Cada una **envuelve algo que ya existía** (brain, RAG, el
puente) en vez de reimplementarlo: `call_contact` delega la resolución del contacto a
`brain.js`, y `device_action` tiene su `what` acotado a una lista de 8 valores en vez de
ser 8 herramientas distintas — menos superficie que inventar.

### El modelo elige, este archivo decide qué se ejecuta
Un modelo chico inventa nombres, deja argumentos sueltos y mete JSON en un ```json. El
bucle no confía, y **el motivo del rechazo vuelve al modelo** (que es lo que hace que el
segundo intento acierte):

| El modelo mandó | Qué pasa |
|---|---|
| herramienta inexistente | se rechaza, con la lista de las que sí existen |
| argumento que no está en el esquema | se rechaza, con los nombres reales de los argumentos |
| obligatorio que falta | se rechaza nombrando el argumento |
| tipo que no cierra | se rechaza |
| argumento enorme (>200) | se rechaza: eso es prompt injection, no un dato |
| JSON inválido | se rechaza y se reintenta |

### Una sola fuente de verdad
`args` genera **dos** cosas: el texto del prompt y la validación. No pueden desalinearse
porque salen del mismo objeto. Cuando el nativo soporte
`llama_sampler_init_grammar`, la gramática GBNF se deriva de ahí —y hasta entonces el
parse + reintento hace falta igual, porque un modelo chico va a fallar el JSON de vez en
cuando.

### BUG que encontraron los tests
`isDone()` devolvía `true` siempre que el JSON **no** trajera la palabra `listo`. O sea que
`{"tool":"set_alarm","args":{...}}` —que es exactamente lo que contesta un modelo que no
entendió "si no necesitás ninguna: {listo:true}"— se leía como "terminado" y **el bucle
cortaba antes de ejecutar nada**. Kiu se quedaba mudo. Ahora: si el objeto trae una
herramienta, no está terminado, diga lo que diga el resto.

### Enrutado
El agente va **después** de skills, cerebro y ReAct (lo conocido se resuelve al instante y
sin gastar un token; ninguna de las tres conoce una herramienta que todavía no existe) y
**antes** de la generación final (si ejecutó algo, esa ES la respuesta). Si no ejecutó nada,
`tryAfterAgent()` sigue el flujo de siempre: el mensaje no se pierde, y el fallback final
sigue estando.

**Apagado por defecto** (`S.agentOn`), con su toggle en Ajustes. Consume una generación
extra por mensaje, así que no puede activarse por sorpresa; y si lo prendés sin modelo
cargado, te lo dice en vez de fingir que quedó activo.

### Lo que NO se hizo (y por qué)
- **GBNF en el nativo**: `vendor_llama.sh` clona `llama.cpp` de `master` **sin pin**. Tocar
  el JNI con eso flotando es Gamble; hay que fijar el commit primero.
- **Confirmación antes de actuar**: `call_contact` abre el marcador (no llama solo) y
  `device_action` tiene su lista acotada, pero no hay diálogo de confirmación. Es la
  costura obvia para una versión con efectos detrás.
- **Visión on-device**: `mtmd` + `.mmproj` son ~300 líneas de C++ en un loop de decode a
  mano, y sin NDK ni llama.cpp vendorizado no hay forma de probarlas. Lo que ya funciona
  (foto → `image_url`, y el modelo de visión local por Ollama) queda como está.

**Suite: 151 → 180 tests**, todos en verde (29 nuevos en `tests/agente.test.mjs`).

## [2.9.0] — Leer la agenda

Kiu sabía **escribir** eventos (`addCalendarEvent` abre el calendario del sistema) pero no
**leerlos**: no había forma de responder "¿qué tengo mañana?" ni de que el resumen matutino
supiera qué día es hoy de verdad.

### Nuevo: `calendarList(query, desde, hasta)` en el puente
Igual que `contacts()`: devuelve JSON o `"NEED_PERM"` para que la UI pida el permiso y avise.
Consulta `CalendarContract.Instances` (que ya resuelve recurrencias) con ventana temporal o
por texto, y:

- excluye lo borrado (`deleted = 0`) y lo que no tiene hora, que no se puede ubicar en el día;
- **tope de 40 eventos y de 60 días de ventana**: una agenda con 5000 eventos no es
  información, es ruido;
- `READ_CALENDAR` es solo lectura. No se pide `WRITE_CALENDAR`: para escribir se sigue usando
  el `Intent` `INSERT`, que deja elegir la app de calendario y es lo que el usuario espera.

### `KiuBrain` entiende las dos preguntas distintas

La diferencia entre "¿qué tengo mañana?" y "¿tengo dentista mañana?" no es una palabra suelta:
es **qué palabra sigue al verbo**. Si es un día ("mañana") o un sustantivo genérico
("algo", "reunión") es una consulta por ventana; si es un nombre ("dentista") es por
contenido. `calWindow()` resuelve hoy / mañana / pasado mañana / esta semana / cada día de la
semana, con el reloj congelado en los tests.

> Ojo con `norm()`: se come el `¿`, así que "¿tengo dentista mañana?" llega como
> `"tengo dentista manana?"`. Los patrones nunca ven el signo de apertura.

**Lo que NO hace, y es lo importante:** sin permiso la respuesta dice que necesita permiso.
Devolver una agenda vacía haría creer al usuario que no tiene eventos, que es peor que un
error — es mentirle con formato de verdad.

### Resumen matutino con la agenda
`MorningReceiver` mete los eventos del día (tope 5) entre los recordatorios y la batería. Todo
el bloque está dentro del `if` del permiso: a las 8am la app no le pide nada a nadie, y sin
permiso el resumen sigue siendo igual de útil.

### Arreglo de paso
`brain.js` mezclaba `window.KiuApp` (en las guardas) con `KiuApp` pelado (en las llamadas). En
el WebView son lo mismo y nunca se rompió, pero **el arnés de tests de `brain.test.mjs` usa
`{window: {}}`** —un objeto aparte del global— así que ahí cualquier referencia pelada es
`ReferenceError`. Por eso esa suite, que tiene 13 tests, nunca ejercitó ni una sola de las
ramas que usan `KiuApp` (contactos, acciones del dispositivo, y ahora la agenda). El arnés de
`tests/calendario.test.mjs` modela `window === global` como el navegador de verdad, y al
escribirlo saltó el bug al instante.

**Suite: 135 → 151 tests**, todos en verde (16 nuevos en `tests/calendario.test.mjs`).

## [2.8.1] — La voz volvió (y el avatar del chat se ve)

Estaban rotas tres cosas y la primera explains a las otras dos: **la activación por
voz y la conversación continua eran el mismo bug**.

### 1 · Causa raíz de la voz: faltaba el `<queries>` del servicio de reconocimiento

`AndroidManifest.xml` no declaraba el servicio de voz del sistema. Desde Android 11
(API 30) la visibilidad de paquetes hace que **la app no lo vea**:

```
SpeechRecognizer.isRecognitionAvailable() → false, SIEMPRE
```

Y ese `false` caía en dos ramas distintas:

| Dónde | Qué pasaba | Qué veía el usuario |
|---|---|---|
| `KiuService.cycle()` | `if (!isRecognitionAvailable) { schedule(6000); return; }` | la palabra de activación nunca escuchaba |
| `MainActivity.startSpeech()` | `convArmed = false` + `nexoVoiceError('unavailable')` | el modo conversación no abría el micrófono |

Es el requisito literal de la documentación de `SpeechRecognizer` para `targetSdk >= 30`:

```xml
<queries>
    <intent><action android:name="android.speech.RecognitionService"/></intent>
    <intent><action android:name="android.intent.action.TTS_SERVICE"/></intent>
</queries>
```

Fuera de `<application>`: adentro el parser del manifest lo rechaza. También se
agregó `TTS_SERVICE`, por el mismo motivo con el motor de voz.

### 2 · La wake word escuchaba la palabra y no el pedido

`WakeWordEngine` (Vosk, offline) al detectar «Kiu`» llamaba a `wakePing()`, que solo
encendía un toast. No había forma de decir qué querés. Ahora `wakeHitAndListen()`:
avisa que te escucha **y abre el micrófono del comando**; como el comando llega por
`nexoOnVoice`, la conversación sigue sola.

- **El motor local era código muerto**: solo arrancaba con la preferencia `wwLocal`
  puesta, y solo la ponía `kiuWWStart()`, que la UI nunca llamaba. Ahora que el modelo
  esté en `models/vosk-es-small/` alcanza, y se recuerda la elección.
- **Un solo micrófono**: hay un `AudioRecord` (Vosk) y un `SpeechRecognizer` (el
  comando). `MainActivity.COMMAND_BUSY` + `pause()/resume()` para que no se peleen, y
  `reset()` del decodificador al volver, para que la palabra a medio decir de antes no
  se junte con la frase siguiente y se auto-dispare.
- **Busy-spin al 100 % de CPU**: con el micro tomado, `a.read()` devuelve `<= 0` y el
  bucle hacía `continue` a secas, para siempre. Ahora cede el hilo y distingue
  «ocupado» de «roto».
- `wakeState()` miraba solo `KiuService.ACTIVE`, así que con el motor local vivo la UI
  creía que la palabra de activación estaba apagada y la volvía a prender en cada
  arranque. Ahora pregunta a los dos.
- Si no hay motor de voz, se avisa (`nexoWakeError`) en vez de fingir que Kiu está
  despierto: antes la app figuraba encendida sin estar escuchando nada.

### 3 · La conversación continua moría al primer turno

El rearme del micrófono pedía `S.conv && this._voiceDriven`, pero `_voiceDriven` solo
se encendía al **apretar el botón del micro**. Si la sesión la abría la palabra de
activación o el fin del TTS —que es justamente el modo manos libres— el bucle se
caía después del primer turno: hablás, Kiu contesta… y silencio.

Con voz apagada el rearme depende de la App, así que ahora alcanza con `S.conv`.
Con voz encendida lo maneja Java al terminar el TTS: los dos caminos no se pisan.

- `nexoListenStart` no marcaba `App.voiceBusy`, así que el JS creía que el micrófono
  estaba libre cuando lo tenía abierto el bucle de Java.
- `openConvMic()` ahora no reabre si el reconocedor del comando ya está vivo: dos
  reconocedores compitiendo se pisan y el primero se destruye a mitad de frase.
- `startSpeech()` soltaba el reconocedor viejo **después** de tomar el nuevo, así que
  el comando se cancelaba solo.

### 4 · El avatar del chat se dibujaba encima del título

`#chat-avatar`, `#hero-avatar` y `#profile-avatar` no tenían caja. Las clases que los
dimensionaban (`.kav-hero`, `.kav-big`, `.kav-profile` con `--kav-s`) eran del robot
viejo de pantalla LED —`avatar.js`, borrado en la 2.7.0— y el bot nuevo vive en su
Shadow DOM, así que **`--kav-s` ya no lo leía nadie**. Resultado: los `<div>` quedaban
en `0x0` dentro de su flex, `fitSize()` caía al id (`chat-avatar` → 64 px) y el bot se
pintaba encima del texto de al lado.

- El hueco ahora tiene caja propia y el tamaño en px; el CSS es la **única** fuente de
  la medida (`KiuAvatar.declaredSize()` la lee, incluso con la pantalla oculta) en vez
  de una lista de números en el JS que además se contradecía con el CSS.
- El tamaño cuelga del **id**, no de la clase: `#chat-avatar` es `kav-mini kav-big` y,
  si mandara la clase, ganaba la última del archivo y se quedaba en 40 px en vez de 44.
- `refit()` ya no se salta los hosts sin layout: usaban el tamaño de emergencia para
  siempre. El piso de tamaño bajó de 54 a 30 px, porque los huecos chicos son de 40 y
  44 y un piso mayor los desbordaba igual.
- `logo-mini` se fue del HTML: era el cuadrito con degradado y letra del logo viejo y,
  por especificidad, le ganaba al ancho del hueco.
- El bot del chat ya sigue el estado de la tarea como corresponde («Indexando» con la
  lupa al leer documentos, «Acción del dispositivo» con el engranaje al tocar el
  teléfono, «Enrutando» al buscar, «RAG activo» con el libro…): el problema era de
  tamaño, no de estado.

### Otros arreglos

- **`bridge_audit.py` miraba la mitad de los eventos**: solo detectaba `window.nexoX(`
  (KiuJsPost) y `window.X(', `, así que los que `MainActivity` manda con
  `js("nexoX(...)")` —la mayoría— nunca se auditaron. Ahora los ve todos y además
  avisa si Java manda un evento que el JS no escucha. Contrato verificado: 86 métodos,
  15 eventos Java→JS, cero llamadas fantasma.
- Suite: 115 → **135 tests**, todos en verde. Los 20 nuevos viven en
  `tests/voz.test.mjs` y fijan los tres contratos (manifiesto, ciclo del micrófono,
  rearme del bucle y caja de cada hueco del bot).

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
