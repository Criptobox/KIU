package com.kiu.agent;

import android.content.Context;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;

import org.json.JSONObject;
import org.vosk.Model;
import org.vosk.Recognizer;

import java.io.File;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Wake word 100% local y offline (Vosk, gramática cerrada, loop AudioRecord propio).
 *
 * Alternativa al KiuService (SpeechRecognizer de Google) para el modo manos
 * libres: no depende de los servicios de Google ni de red.
 *
 * Modelo: vosk-model-small-es-0.42 (~40 MB descomprimido) colocado en
 *   <.getExternalFilesDir>/models/vosk-es-small/
 * con la estructura del zip oficial, OJO que final.mdl va en am/final.mdl y no
 * en la raíz (v2.9.3: el chequeo miraba la raíz y no encontraba un modelo que
 * estaba perfectamente puesto).
 * (se puede bajar con el gestor de descargas de la app e importar con KiuImport)
 *
 * Uso desde el puente JS: kiuWWStart() / kiuWWStop() / kiuWWState()
 * Al detectar "kiu" dispara el mismo hook que el servicio: nexoWakeHit() y,
 * además, MainActivity.wakeHitAndListen() abre el micrófono del comando (v2.8.1:
 * antes solo encendía un toast y se quedaba ahí, sin forma de pedir nada).
 */
public class WakeWordEngine {
    private static final String DIR_NAME = "vosk-es-small";
    private static final long COOLDOWN_MS = 4000;
    private static final int SAMPLE_RATE = 16000;
    /* v2.10.2 · «KIU» NO ES UNA PALABRA DEL ESPAÑOL. El modelo solo puede reconocer
       palabras de su vocabulario (graph/words.txt); una palabra fuera de él se ignora al
       armar la gramática. Con «kiu» fuera, el motor arrancaba, decía «activo» y nunca
       podía oír su palabra. Ahora se prueban varias grafías, se dejan solo las que el
       modelo conoce, se agrega [unk] para que el resto del habla no se fuerce hacia ellas,
       y si ninguna existe se avisa y se cae al reconocedor del sistema. */
    private static final String[] PRINCIPALES = {"kiu", "quiu", "kiwi", "kyu", "ciu", "chiu", "kio"};
    private static final String[] AUXILIARES = {"iu", "ki"};
    /** true cuando el motor local no puede servir: StartWake usa el reconocedor del sistema. */
    public static volatile boolean localUnusable = false;
    private volatile java.util.Set<String> palabrasHit = new java.util.HashSet<String>();

    private static volatile WakeWordEngine inst;

    private volatile Model model;
    private volatile Recognizer recognizer;
    private volatile AudioRecord mic;
    private final AtomicBoolean running = new AtomicBoolean(false);
    private final AtomicBoolean paused = new AtomicBoolean(false);
    private volatile boolean loading = false;
    private volatile String err = "";
    private long lastHit = 0;

    public static WakeWordEngine get() {
        if (inst == null) {
            synchronized (WakeWordEngine.class) {
                if (inst == null) {
                    inst = new WakeWordEngine();
                }
            }
        }
        return inst;
    }

    /* v2.9.3 · BUG REAL: el chequeo del modelo miraba el lugar equivocado.

       El modelo oficial (vosk-model-small-es-0.42) tiene esta estructura:

           vosk-model-small-es-0.42/
             am/final.mdl      <-- acá está
             conf/mfcc.conf
             conf/model.conf
             graph/...

       El código chequeaba <dir>/final.mdl, o sea la RAÍZ. Con el modelo puesto
       exactamente donde dice la documentación, ese archivo no existe: el chequeo
       daba false, el arranque se negaba, y el error que llegaba decía "falta el
       modelo" — que es una mentira: el modelo estaba, en su sitio, y la app
       no lo veía. Encima el síntoma es exactamente el reportado: la palabra de
       activación nunca dispara y no hay forma de saber por qué.

       Se aceptan los dos layouts a propósito: el oficial (am/final.mdl) y el
       "aplanado" (final.mdl en la raíz), que es lo que queda si alguien copió
       el contenido de am/ a mano. La app carga siempre la RAÍZ del modelo en
       Model(), que es lo que Vosk espera. */
    private static File modelRoot(Context ctx) {
        return new File(modelDir(ctx));
    }

    /** ¿Está el modelo local? Acepta el layout oficial (am/final.mdl) y el aplanado. */
    public static boolean modelPresent(Context ctx) {
        try {
            File d = modelRoot(ctx);
            return new File(d, "am/final.mdl").exists() || new File(d, "final.mdl").exists();
        } catch (Throwable th) {
            return false;
        }
    }

    public static String modelDir(Context ctx) {
        File base = KiuDownload.modelsDir(ctx);
        return new File(base, DIR_NAME).getAbsolutePath();
    }

    public String getErr() {
        return err;
    }

    /** Arranca la escucha local (idempotente). Devuelve false si falta modelo o mic. */
    public boolean start(Context ctx) {
        final Context app = ctx.getApplicationContext();
        if (running.get() || loading) {
            return true;
        }
        try {
            if (app.checkSelfPermission("android.permission.RECORD_AUDIO") != 0) {
                err = "falta permiso de microfono";
                return false;
            }
            String dir = modelDir(app);
            if (!new File(dir, "am/final.mdl").exists() && !new File(dir, "final.mdl").exists()) {
                err = "modelo wake word no instalado (models/" + DIR_NAME + ")";
                return false;
            }
            err = "";
            paused.set(false);
            lastHit = 0;
            loading = true;
            new Thread(new Runnable() {
                @Override
                public void run() {
                    WakeWordEngine.this.run(app, dir);
                }
            }, "kiu-wakeword").start();
            return true;
        } catch (Throwable th) {
            loading = false;
            err = String.valueOf(th);
            return false;
        }
    }

    /* v2.9.5 · RECUPERACIÓN DEL MICRÓFONO.
       BUG REAL: cuando AudioRecord.read() devuelve un error (ERROR_DEAD_OBJECT
       cuando el mic lo toma una llamada o otra app), el código ponía el mensaje
       y hacía `continue` SOBRE EL MISMO AudioRecord. Un AudioRecord en estado de
       error no se recupera: hay que stop()/release() y crear otro. Seguir leyendo
       del mismo devuelve el error para siempre.

       El síntoma era el peor posible: atendías un teléfono, cortabas, y la
       palabra de activación no volvía más — hasta que la apagabas y la prendías
       a mano, sin ningún mensaje en el medio.

       Ahora el read-loop se ROTA al primer error de mic y el loop de afuera
       reconstruye el AudioRecord con backoff. Si no vuelve después de varios
       intentos, se rinde y lo DICE (running=false), en vez de quedarse mudo
       fingiendo que escucha. */
    private static final int MIC_RETRY_BASE_MS = 500;
    private static final int MIC_RETRY_MAX_MS = 8000;
    private static final int MIC_MAX_RETRIES = 8;

    /* Estado que devuelve el read-loop. Un int plano, no un enum: lo más simple
       es lo que menos se rompe.
       Son SOLO DOS, a propósito. Había un tercer estado (OK) que nadie
       devolvía, y el `reset()` del backoff estaba colgado de él: el backoff
       nunca se reiniciaba, así que después de 8 micro-fallos repartidos a lo
       largo de una sesión, Kiu se rendía para siempre. El backoff se resetea
       en el sitio donde tiene sentido: cuando el micrófono ABRE, no cuando la
       sesión termina. */
    private static final int LECHO_MIC_MUERTO = 1;   // hay que reconstruir el AudioRecord
    private static final int LECHO_PARADO = 2;       // el usuario apagó la palabra de activación

    private void run(Context app, String dir) {
        boolean fallo = false;
        try {
            String grammar = armarGramatica(dir);
            if (grammar == null) {
                throw new IllegalStateException("el modelo no conoce ninguna grafía de «Kiu»");
            }
            model = new Model(dir);
            recognizer = new Recognizer(model, (float) SAMPLE_RATE, grammar);
            int minBuf = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT);
            int bufSize = Math.max(minBuf, SAMPLE_RATE); // 1s
            short[] buf = new short[3200];                 // 200 ms
            running.set(true);
            loading = false;

            Backoff espera = new Backoff(MIC_RETRY_BASE_MS, MIC_RETRY_MAX_MS, MIC_MAX_RETRIES);

            while (running.get()) {
                int st = escucharUnaVez(bufSize, buf, espera);
                if (st != LECHO_MIC_MUERTO) {
                    break;   // LECHO_PARADO: lo apagó el usuario
                }
                /* LECHO_MIC_MUERTO: el read-loop ya terminó y soltó el AudioRecord.
                   Se reconstruye con backoff; si se agotan los intentos se RINDE
                   Y LO DICE, en vez de quedarse mudo fingiendo que escucha. */
                long d = espera.siguiente();
                if (d < 0) {
                    err = "el microfono no volvio (ocupado por otra app o por el sistema)";
                    running.set(false);
                    break;
                }
                avisar("nexoWakeError('" + err.replace("'", "") + "')");
                dormir(d);
            }
        } catch (Throwable th) {
            err = "wake word: " + th;
            fallo = true;
        } finally {
            running.set(false);
            loading = false;
            mic = null;
            cerrarRecon();
            cerrarModelo();
            if (MainActivity.inst != null) {
                MainActivity.inst.js("nexoWakeState(false)");
                /* Un fallo del MOTOR (modelo, librería nativa, gramática) no es lo mismo que
                   un micrófono ocupado: el segundo se reintenta, el primero se repetiría
                   igual. Se marca el camino local como inservible y se arranca el del
                   sistema, para que «Kiu» funcione aunque sea con internet. */
                if (fallo) {
                    localUnusable = true;
                    MainActivity.inst.js("nexoWakeError('motor local no disponible, uso el del sistema: "
                            + err.replace("'", "").replace("\n", " ") + "')");
                    MainActivity.inst.startWakeNow();
                }
            }
        }
    }

    /** Arma la gramática solo con grafías que existen en el vocabulario del modelo. */
    private String armarGramatica(String dir) {
        java.util.Set<String> vocab = new java.util.HashSet<String>();
        java.io.File w = new java.io.File(dir, "graph/words.txt");
        if (w.exists()) {
            java.io.BufferedReader br = null;
            try {
                br = new java.io.BufferedReader(new java.io.InputStreamReader(new java.io.FileInputStream(w), "UTF-8"));
                String line;
                while ((line = br.readLine()) != null) {
                    int sp = line.indexOf(' ');
                    vocab.add((sp > 0 ? line.substring(0, sp) : line).trim().toLowerCase());
                }
            } catch (Throwable ignored) {
            } finally {
                try {
                    if (br != null) {
                        br.close();
                    }
                } catch (Throwable ignored) {
                }
            }
        }
        java.util.List<String> ok = new java.util.ArrayList<String>();
        for (String c : PRINCIPALES) {
            if (vocab.isEmpty() || vocab.contains(c)) {
                ok.add(c);
            }
        }
        if (ok.isEmpty()) {
            for (String c : AUXILIARES) {
                if (vocab.isEmpty() || vocab.contains(c)) {
                    ok.add(c);
                }
            }
        }
        if (ok.isEmpty()) {
            return null;
        }
        StringBuilder g = new StringBuilder("[");
        for (String c : ok) {
            g.append('"').append(c).append("\",");
        }
        g.append("\"[unk]\"]");
        palabrasHit = new java.util.HashSet<String>(ok);
        return g.toString();
    }

    /** Crea un AudioRecord, escucha hasta que algo pare, y devuelve el estado. */
    private int escucharUnaVez(int bufSize, short[] buf, Backoff espera) {
        AudioRecord a = null;
        try {
            a = new AudioRecord(MediaRecorder.AudioSource.MIC, SAMPLE_RATE,
                    AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, bufSize);
            if (a.getState() != AudioRecord.STATE_INITIALIZED) {
                err = "microfono ocupado por otra app";
                return LECHO_MIC_MUERTO;
            }
            mic = a;
            a.startRecording();
            /* el mic abrió de verdad: el error anterior (si hubo) ya no dice
               nada. Sin esto el mensaje quedaba pegado para toda la sesión
               aunque todo volviera a funcionar (bug 2 de esta tanda).

               Y el backoff arranca de cero: los fallos anteriores quedaron
               atrás. El motivo es que el presupuesto de reintentos es POR
               MICROFONO, no por sesión: si una app toma el micro un rato y lo
               suelta, ese contratiempo no puede gastar los reintentos de los
               próximos treinta minutos. */
            err = "";
            espera.reset();
            avisar("nexoWakeState(true)");

            boolean limpio = true;
            while (running.get()) {
                int n = a.read(buf, 0, buf.length);
                if (n <= 0) {
                    if (n == AudioRecord.ERROR_INVALID_OPERATION || n == AudioRecord.ERROR_BAD_VALUE
                            || n == AudioRecord.ERROR_DEAD_OBJECT) {
                        /* El mic murió. NO se sigue leyendo: hay que liberar y
                           reconstruir, y de eso se encarga el loop de arriba. */
                        err = "microfono no disponible (lo tomo otra app o el sistema)";
                        return LECHO_MIC_MUERTO;
                    }
                    /* elsewhere: buffer a medio llenar. Antes esto era un
                       busy-spin (100 % de CPU de un hilo, para siempre). */
                    if (!dormir(80L)) {
                        return LECHO_PARADO;
                    }
                    continue;
                }
                /* Mientras Kiu habla por TTS no escuchamos (evita auto-disparo),
                   y tampoco mientras el reconocedor de comando tiene el micro: este
                   bucle ya lo consumió, así que no puede volver a activarse. */
                if (MainActivity.SPEAKING || MainActivity.COMMAND_BUSY || paused.get()) {
                    /* Al entrar en silencio se resetea el decodificador UNA vez: si
                       no, la palabra a medio decir de antes se junta con la próxima
                       frase y «Kiu» vuelve a dispararse solo. (org.vosk.Recognizer
                       no tiene setPartialHypothesis; reset() sí, y es lo correcto.) */
                    if (!limpio) {
                        reseteaRecon();
                        limpio = true;
                    }
                    continue;
                }
                limpio = false;
                Recognizer r = recognizer;
                if (r == null) {
                    return LECHO_PARADO;
                }
                if (r.acceptWaveForm(buf, n)) {
                    check(r.getResult());
                } else {
                    check(r.getPartialResult());
                }
            }
            return LECHO_PARADO;
        } catch (Throwable th) {
            err = "microfono: " + th;
            return LECHO_MIC_MUERTO;
        } finally {
            mic = null;
            try {
                if (a != null) {
                    a.stop();
                    a.release();
                }
            } catch (Throwable unused) {
            }
        }
    }

    private void reseteaRecon() {
        Recognizer rr = recognizer;
        if (rr != null) {
            try {
                rr.reset();
            } catch (Throwable ignored) {
            }
        }
    }

    private void cerrarRecon() {
        try {
            Recognizer r = recognizer;
            if (r != null) {
                r.close();
            }
        } catch (Throwable unused) {
        }
        recognizer = null;
    }

    private void cerrarModelo() {
        try {
            Model m = model;
            if (m != null) {
                m.close();
            }
        } catch (Throwable unused) {
        }
        model = null;
    }

    private void avisar(String js) {
        MainActivity m = MainActivity.inst;
        if (m != null) {
            m.js(js);
        }
    }

    /** Duerme. Devuelve false si lo interrumpieron (o si hay que parar). */
    private boolean dormir(long ms) {
        try {
            Thread.sleep(ms);
            return true;
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
            return false;
        }
    }

    private void check(String json) {
        try {
            if (json == null) {
                return;
            }
            JSONObject o = new JSONObject(json);
            String text = o.optString("partial", o.optString("text", ""));
            boolean hit = false;
            if (text.length() > 0) {
                for (String tk : text.toLowerCase().split("\\s+")) {
                    if (palabrasHit.contains(tk)) {
                        hit = true;
                        break;
                    }
                }
            }
            if (hit) {
                long now = System.currentTimeMillis();
                if (now - lastHit > COOLDOWN_MS) {
                    lastHit = now;
                    /* v2.8.1: antes esto solo encendía nexoWakeHit() (un toast) y
                       se moría ahí. La palabra de activación sin comando detrás no
                       sirve de nada. Ahora el mismo hook del servicio: avisar que
                       te escuchan Y abrir el micrófono para que digas el pedido.
                       El bucle se pausa solo mientras el comando se escucha
                       (MainActivity.COMMAND_BUSY) para no pelear por el micro. */
                    MainActivity.wakeHitAndListen(appCtx());
                }
            }
        } catch (Throwable unused) {
        }
    }

    /** Cede el micrófono mientras otro reconocedor (el del comando) está activo. */
    public void pause() {
        paused.set(true);
    }

    public void resume() {
        paused.set(false);
    }

    public boolean isPaused() {
        return paused.get();
    }

    private Context appCtx() {
        MainActivity m = MainActivity.inst;
        return m != null ? m.getApplicationContext() : null;
    }

    /** Detiene la escucha local y libera el modelo (idempotente). */
    public void stop() {
        running.set(false);
        paused.set(false);
        try {
            AudioRecord a = mic;
            if (a != null) {
                a.stop();
            }
        } catch (Throwable unused) {
        }
    }

    public boolean isRunning() {
        return running.get() || loading;
    }

    /** JSON de estado para el puente JS. */
    public String statusJson(Context ctx) {
        boolean present = modelPresent(ctx);
        String s = running.get() ? (paused.get() ? "pause" : "run") : (loading ? "load" : "idle");
        StringBuilder sb = new StringBuilder();
        sb.append("{\"st\":\"").append(s).append("\"");
        sb.append(",\"present\":").append(present);
        sb.append(",\"err\":\"").append(err.replace("\"", "'")).append("\"");
        sb.append(",\"path\":\"").append(modelDir(ctx).replace("\"", "'")).append("\"");
        sb.append("}");
        return sb.toString();
    }
}
