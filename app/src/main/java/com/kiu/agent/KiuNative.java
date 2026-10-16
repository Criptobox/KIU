package com.kiu.agent;

/* loaded from: classes.dex */
public class KiuNative {
    private static boolean ok;

    static {
        try {
            System.loadLibrary("kiullama");
            ok = true;
        } catch (Throwable th) {
            ok = false;
        }
    }

    public static boolean available() {
        return ok;
    }

    public static native void freeModel();

    public static native String genStatus();

    public static native String generate(String str, int i, float f);

    public static native boolean isLoaded();

    public static native String lastError();

    public static native boolean loadModel(String str, int i, int i2);

    public static native String loadProgress();

    public static native void stopGen();

    /* v2.9.2: gramatica de muestreo GBNF para la PROXIMA generate(). Se separa
       de generate() a proposito: cambiar la firma de un metodo nativo rompe el
       puente JS entero (kiuGen) y obliga a tocar dos lados.
       "" desactiva. La consume (y la borra) la generate() siguiente, y stopGen()
       tambien la limpia: una gramatica pegada dejaria atada toda generacion
       posterior — un forgetting con forma de bug fantasma. */
    public static native void setGrammar(String gbnf);

    /** La gramatica que espera ser aplicada (diagnostico / tests). */
    public static native String grammarPending();

    /** La ultima gramatica se pudo aplicar? Si es false, el motor genero texto
        SIN restringir: el bucle tiene que saberlo, porque el parse + reintento
        sigue siendo la ruta real. */
    public static native boolean grammarOk();

    public static native float tokensPerSec();
}
