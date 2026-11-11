package com.kiu.agent;

import java.util.Locale;

/**
 * Antirrebote del comando de voz: la misma frase dos veces en {@code ventanaMs} cuenta una sola.
 *
 * <p>Extraído de {@code MainActivity.wakeDup} (v2.23.0) para poder probarlo en una JVM normal:
 * es lógica pura, sin una sola import de Android. El reloj entra por parámetro para que el
 * arnés lo mueva a mano (en la app se pasa {@code SystemClock.elapsedRealtime()}).
 */
final class WakeDedupe {
    private final long ventanaMs;
    private String ultimo = "";
    private long ultimoEn = 0;
    private boolean hayUltimo = false;

    WakeDedupe(long ventanaMs) {
        this.ventanaMs = ventanaMs;
    }

    /** true si {@code s} repite la frase anterior dentro de la ventana (y entonces NO se renueva la hora). */
    synchronized boolean esRepetido(String s, long ahoraMs) {
        String k = s == null ? "" : s.trim().toLowerCase(Locale.ROOT);
        if (hayUltimo && k.equals(ultimo) && ahoraMs - ultimoEn < ventanaMs) return true;
        ultimo = k;
        ultimoEn = ahoraMs;
        hayUltimo = true;
        return false;
    }
}
