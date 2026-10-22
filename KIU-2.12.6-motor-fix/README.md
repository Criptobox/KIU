# KIU 2.12.6 — parche de recuperación del motor

Base inspeccionada: APK release KIU 2.12.5 (versionCode 79, git 52657e0), extraída de `Kiu-APK-release (3).zip`.

## Hallazgo del código

En `assets/www/js/app/motor.js`, si `kiuGen` es rechazado en los 9 intentos de inicio, el código anterior borraba `busyG` y `pending` en JavaScript pero no llamaba a `kiuResetBusy` en el puente nativo. El watchdog de 10 minutos también detenía la generación sin resetear explícitamente el estado nativo. Esa desincronización es una causa plausible del mensaje repetido «el motor sigue ocupado» que aparece en la captura; no prueba que sea la única causa en el teléfono.

## Cambio

- Al agotarse los reintentos de inicio, llama a `kiuResetBusy` antes de devolver el error.
- En el watchdog, limpia el estado JS, intenta parar la generación y resetear el estado nativo, con manejo de excepciones.
- No resetea el motor mientras el inicio aún está en reintento ni interrumpe una generación que sí se inició.

## Integración

Reemplazar `app/src/main/assets/www/js/app/motor.js` en el proyecto fuente por este archivo y actualizar versionName/versionCode a `2.12.6`/`80` antes de compilar. Este paquete es un parche de código, NO una APK firmada nueva.

## Verificación

`node --check` verifica sintaxis. La prueba de regresión adjunta verifica que ambas rutas de fallo mantengan el reset nativo. No hay emulador Android ni dispositivo conectado en el entorno de esta ejecución, por lo que no se afirma instalación ni prueba de interfaz real.
