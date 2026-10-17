package com.kiu.agent;

import java.io.File;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Instalación del modelo local de la palabra de activación (v2.9.7).
 *
 * <p>Existencia justificada: el modelo Vosk español son 39 MB, así que no puede ir en
 * el repo, y hasta ahora la única forma de instalarlo era saber el comando de
 * {@code adb} y conocer el layout interno del zip. Sin modelo, la palabra de
 * activación local está muerta, y nada en la app lo decía: prendías el micrófono y
 * no pasaba nada, sin error ni aviso.
 *
 * <p>La descarga reusa {@link KiuDownload}, que ya tiene reanudación, SHA-256 y
 * verificación. La extracción la hace {@link ZipInstall}, que es Java puro y está
 * testeada contra el zip real. Esta clase solo coordina: arranca, reporta, y avisa.
 */
public final class KiuVoskInstall {

    /** Zip oficial. El SHA está fijado porque el catálogo de modelos no cubre este. */
    public static final String URL =
            "https://alphacephei.com/vosk/models/vosk-model-small-es-0.42.zip";
    public static final String SHA256 = "09b239888f633ef2f0b4e09736e3d9936acfd810bc65d53fad45261762c6511f";
    public static final String ZIP_NAME = "vosk-model-small-es-0.42.zip";
    public static final long ZIP_BYTES = 39817833L;
    /** Carpeta que espera {@link WakeWordEngine}. */
    public static final String DIR_NAME = "vosk-es-small";

    private static final Map<String, Job> JOBS = new ConcurrentHashMap<String, Job>();

    private static final class Job {
        volatile String state = "queued";   // queued | unzip | done | error
        volatile String err = "";
        volatile long files = 0;
        volatile long bytes = 0;
        volatile int skipped = 0;
        volatile boolean cancel = false;
    }

    private KiuVoskInstall() {
    }

    /** ¿Está el modelo instalado y bien puesto? */
    public static boolean present(android.content.Context ctx) {
        return ZipInstall.sirveComoModelo(dir(ctx));
    }

    public static String dir(android.content.Context ctx) {
        return new File(KiuDownload.modelsDir(ctx), DIR_NAME).getAbsolutePath();
    }

    /** Arranca la descarga del zip con el motor de descargas existente. */
    public static String start(android.content.Context ctx) {
        try {
            if (present(ctx)) {
                return "{\"st\":\"done\",\"present\":true}";
            }
            return KiuDownload.start(ctx, URL, ZIP_NAME, "", SHA256);
        } catch (Throwable th) {
            return "{\"st\":\"error\",\"err\":\"" + esc(String.valueOf(th)) + "\"}";
        }
    }

    /** Descomprime el zip ya descargado. Devuelve el id del job para seguir el progreso. */
    public static String unzip(android.content.Context ctx, String zipPath) {
        try {
            File z = new File(zipPath == null ? "" : zipPath);
            if (!z.exists()) {
                return "{\"st\":\"error\",\"err\":\"no encuentro el zip descargado\"}";
            }
            if (!z.getName().endsWith(".zip")) {
                return "{\"st\":\"error\",\"err\":\"eso no es un .zip\"}";
            }
            final String zipAbs = z.getAbsolutePath();
            final String destDir = dir(ctx);
            final String id = "v" + System.currentTimeMillis();
            final Job job = new Job();
            JOBS.put(id, job);
            new Thread(new Runnable() {
                @Override
                public void run() {
                    job.state = "unzip";
                    ZipInstall.Result res = ZipInstall.extract(zipAbs, destDir, new ZipInstall.Progress() {
                        @Override
                        public void onBytes(long total) {
                            job.bytes = total;
                        }

                        @Override
                        public void onFile(long bytes) {
                            job.files++;
                        }
                    });
                    job.bytes = res.bytes;
                    job.skipped = res.skipped;
                    job.err = esc(res.err);
                    /* Instalar y que no sirva es peor que no instalar: antes de decir
                       que terminó se comprueba que el modelo quede donde el motor lo
                       busca. Si no, el usuario ve «listo» y después la palabra de
                       activación no funciona, sin forma de saber por qué. */
                    if (!res.ok) {
                        job.state = "error";
                    } else if (!ZipInstall.sirveComoModelo(destDir)) {
                        job.state = "error";
                        job.err = "el modelo quedó mal puesto: falta am/final.mdl";
                    } else {
                        job.state = "done";
                    }
                }
            }, "kiu-vosk-unzip").start();
            return "{\"id\":\"" + id + "\",\"st\":\"queued\"}";
        } catch (Throwable th) {
            return "{\"st\":\"error\",\"err\":\"" + esc(String.valueOf(th)) + "\"}";
        }
    }

    public static String cancel() {
        for (Job j : JOBS.values()) {
            j.cancel = true;
        }
        return "{\"st\":\"ok\"}";
    }

    public static String status(String id) {
        Job j = id == null ? null : JOBS.get(id);
        if (j == null) {
            return "{\"st\":\"none\"}";
        }
        StringBuilder b = new StringBuilder(160);
        b.append("{\"st\":\"").append(j.state).append("\"");
        b.append(",\"files\":").append(j.files);
        b.append(",\"bytes\":").append(j.bytes);
        b.append(",\"skipped\":").append(j.skipped);
        b.append(",\"err\":\"").append(esc(j.err)).append("\"}");
        return b.toString();
    }

    private static String esc(String s) {
        if (s == null) {
            return "";
        }
        return s.replace("\\", "\\\\").replace("\"", "'").replace("\n", " ").replace("\r", " ");
    }
}
