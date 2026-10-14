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

    public static native float tokensPerSec();
}
