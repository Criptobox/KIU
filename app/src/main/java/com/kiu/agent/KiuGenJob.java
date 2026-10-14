package com.kiu.agent;

/* loaded from: classes.dex */
public class KiuGenJob implements Runnable {
    public static String a1;
    public static int a2;
    public static float a3;
    public static int a4;
    public static boolean busy;
    public static int jt;

    public static String esc(String str) {
        if (str == null) {
            return "";
        }
        try {
            return str.replace("\\", "\\\\").replace("\"", "\\\"").replace("\r\n", "\\n").replace("\n", "\\n").replace("\r", "\\n").replace("\t", " ");
        } catch (Throwable th) {
            return str;
        }
    }

    /* v2.6.1 (auditoría de memoria): liberación asíncrona del modelo nativo.
       La llaman onDestroy() de MainActivity (cierre real, no rotación) y el de
       KiuService (cuando ya no queda actividad viva). stopGen() hace que una
       generación en curso aborte rápido; freeModel() toma g_mtx en C++ y espera
       a poder soltar contexto + modelo, por eso corre en su propio hilo y no
       congela el hilo que destruye la actividad/servicio. Es idempotente:
       free_locked() chequea punteros null bajo mutex. */
    public static void freeAsync() {
        new Thread(new Runnable() {
            @Override // java.lang.Runnable
            public void run() {
                try {
                    KiuNative.stopGen();
                } catch (Throwable th) {
                }
                try {
                    KiuNative.freeModel();
                } catch (Throwable th) {
                }
            }
        }, "kiu-free").start();
    }

    @Override // java.lang.Runnable
    public void run() {
        busy = true;
        String str = null;
        try {
            int i = jt;
            if (i != 1) {
                if (i == 2) {
                    long currentTimeMillis = System.currentTimeMillis();
                    String generate = KiuNative.generate(a1, a2, a3);
                    long currentTimeMillis2 = System.currentTimeMillis() - currentTimeMillis;
                    if (generate != null) {
                        str = "if(window.kiuNativeDone)window.kiuNativeDone({\"op\":\"gen\",\"ok\":true,\"text\":\"" + String.valueOf(esc(generate)) + "\",\"ms\":" + currentTimeMillis2 + ",\"tps\":" + KiuNative.tokensPerSec() + "})";
                    } else {
                        str = "if(window.kiuNativeDone)window.kiuNativeDone({\"op\":\"gen\",\"ok\":false,\"err\":\"" + String.valueOf(esc(KiuNative.lastError())) + "\",\"ms\":" + currentTimeMillis2 + "})";
                    }
                } else if (i == 3) {
                    KiuNative.freeModel();
                    str = "if(window.kiuNativeDone)window.kiuNativeDone({\"op\":\"free\",\"ok\":true})";
                }
            } else if (!KiuNative.available()) {
                str = "if(window.kiuNativeDone)window.kiuNativeDone({\"op\":\"load\",\"ok\":false,\"err\":\"libreria nativa no disponible\"})";
            } else if (KiuNative.loadModel(a1, a2, a4)) {
                str = "if(window.kiuNativeDone)window.kiuNativeDone({\"op\":\"load\",\"ok\":true,\"path\":\"" + esc(a1) + "\"})";
            } else {
                str = "if(window.kiuNativeDone)window.kiuNativeDone({\"op\":\"load\",\"ok\":false,\"err\":\"" + String.valueOf(esc(KiuNative.lastError())) + "\"})";
            }
        } catch (Throwable th) {
            try {
                str = "if(window.kiuNativeDone)window.kiuNativeDone({\"op\":\"err\",\"err\":\"" + String.valueOf(esc(th.toString())) + "\"})";
            } catch (Throwable th2) {
            }
        }
        busy = false;
        if (str != null) {
            try {
                MainActivity mainActivity = MainActivity.inst;
                if (mainActivity != null) {
                    mainActivity.runOnUiThread(new KiuJsPost(str));
                }
            } catch (Throwable th3) {
            }
        }
    }
}
