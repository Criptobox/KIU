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
 * (se puede bajar con el gestor de descargas de la app e importar con KiuImport)
 *
 * Uso desde el puente JS: kiuWWStart() / kiuWWStop() / kiuWWState()
 * Al detectar "kiu" dispara el mismo hook que el servicio: nexoWakeHit()
 */
public class WakeWordEngine {
    private static final String DIR_NAME = "vosk-es-small";
    private static final long COOLDOWN_MS = 4000;
    private static final int SAMPLE_RATE = 16000;
    private static final String GRAMMAR = "[\"kiu\",\"hey kiu\",\"iu\",\"ki\"]";

    private static volatile WakeWordEngine inst;

    private volatile Model model;
    private volatile Recognizer recognizer;
    private volatile AudioRecord mic;
    private final AtomicBoolean running = new AtomicBoolean(false);
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

    /** ¿Hay modelo local instalado? (final.mdl dentro de models/vosk-es-small) */
    public static boolean modelPresent(Context ctx) {
        try {
            return new File(modelDir(ctx), "final.mdl").exists();
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
            if (!new File(dir, "final.mdl").exists()) {
                err = "modelo wake word no instalado (models/" + DIR_NAME + ")";
                return false;
            }
            err = "";
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

    private void run(Context app, String dir) {
        AudioRecord a = null;
        try {
            model = new Model(dir);
            recognizer = new Recognizer(model, (float) SAMPLE_RATE, GRAMMAR);

            int minBuf = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
            int bufSize = Math.max(minBuf, SAMPLE_RATE); // 1s
            a = new AudioRecord(MediaRecorder.AudioSource.MIC, SAMPLE_RATE,
                    AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, bufSize);
            if (a.getState() != AudioRecord.STATE_INITIALIZED) {
                err = "microfono ocupado por otra app";
                return;
            }
            mic = a;
            a.startRecording();

            short[] buf = new short[3200]; // 200 ms
            running.set(true);
            loading = false;
            if (MainActivity.inst != null) {
                MainActivity.inst.js("nexoWakeState(true)");
            }
            while (running.get()) {
                int n = a.read(buf, 0, buf.length);
                if (n <= 0) {
                    continue;
                }
                // mientras Kiu habla por TTS no escuchamos (evita auto-disparo)
                if (MainActivity.SPEAKING) {
                    continue;
                }
                Recognizer r = recognizer;
                if (r == null) {
                    break;
                }
                if (r.acceptWaveForm(buf, n)) {
                    check(r.getResult());
                } else {
                    check(r.getPartialResult());
                }
            }
        } catch (Throwable th) {
            err = "wake word: " + th;
        } finally {
            running.set(false);
            loading = false;
            try {
                if (a != null) {
                    a.stop();
                    a.release();
                }
            } catch (Throwable unused) {
            }
            mic = null;
            try {
                Recognizer r = recognizer;
                if (r != null) {
                    r.close();
                }
            } catch (Throwable unused) {
            }
            recognizer = null;
            try {
                Model m = model;
                if (m != null) {
                    m.close();
                }
            } catch (Throwable unused) {
            }
            model = null;
            if (MainActivity.inst != null) {
                MainActivity.inst.js("nexoWakeState(false)");
            }
        }
    }

    private void check(String json) {
        try {
            if (json == null) {
                return;
            }
            JSONObject o = new JSONObject(json);
            String text = o.optString("partial", o.optString("text", ""));
            if (text.length() > 0 && text.toLowerCase().contains("kiu")) {
                long now = System.currentTimeMillis();
                if (now - lastHit > COOLDOWN_MS) {
                    lastHit = now;
                    Context c = mic == null ? null : appCtx();
                    MainActivity main = MainActivity.inst;
                    if (main != null) {
                        MainActivity.wakePing(c != null ? c : main);
                    }
                }
            }
        } catch (Throwable unused) {
        }
    }

    private Context appCtx() {
        MainActivity m = MainActivity.inst;
        return m != null ? m.getApplicationContext() : null;
    }

    /** Detiene la escucha local y libera el modelo (idempotente). */
    public void stop() {
        running.set(false);
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
        String s = running.get() ? "run" : (loading ? "load" : "idle");
        StringBuilder sb = new StringBuilder();
        sb.append("{\"st\":\"").append(s).append("\"");
        sb.append(",\"present\":").append(present);
        sb.append(",\"err\":\"").append(err.replace("\"", "'")).append("\"");
        sb.append(",\"path\":\"").append(modelDir(ctx).replace("\"", "'")).append("\"");
        sb.append("}");
        return sb.toString();
    }
}
