package com.kiu.agent;

import android.media.AudioRecord;
import android.media.audiofx.AcousticEchoCanceler;
import android.media.audiofx.AutomaticGainControl;
import android.media.audiofx.NoiseSuppressor;

/**
 * Efectos de audio opcionales ligados a la sesión de AudioRecord.
 * Cada efecto se trata como best-effort: algunos dispositivos/ROM no lo soportan.
 */
final class KiuAudioEffects implements AutoCloseable {
    private AcousticEchoCanceler echo;
    private NoiseSuppressor noise;
    private AutomaticGainControl gain;

    private KiuAudioEffects() {}

    static KiuAudioEffects attach(AudioRecord record) {
        KiuAudioEffects effects = new KiuAudioEffects();
        if (record == null) return effects;
        final int session = record.getAudioSessionId();
        if (session <= 0) return effects;
        try {
            if (AcousticEchoCanceler.isAvailable()) {
                effects.echo = AcousticEchoCanceler.create(session);
                if (effects.echo != null) effects.echo.setEnabled(true);
            }
        } catch (Throwable ignored) { effects.safeReleaseEcho(); }
        try {
            if (NoiseSuppressor.isAvailable()) {
                effects.noise = NoiseSuppressor.create(session);
                if (effects.noise != null) effects.noise.setEnabled(true);
            }
        } catch (Throwable ignored) { effects.safeReleaseNoise(); }
        try {
            if (AutomaticGainControl.isAvailable()) {
                effects.gain = AutomaticGainControl.create(session);
                if (effects.gain != null) effects.gain.setEnabled(true);
            }
        } catch (Throwable ignored) { effects.safeReleaseGain(); }
        return effects;
    }

    private void safeReleaseEcho() { try { if (echo != null) echo.release(); } catch (Throwable ignored) {} echo = null; }
    private void safeReleaseNoise() { try { if (noise != null) noise.release(); } catch (Throwable ignored) {} noise = null; }
    private void safeReleaseGain() { try { if (gain != null) gain.release(); } catch (Throwable ignored) {} gain = null; }

    @Override public void close() {
        safeReleaseEcho();
        safeReleaseNoise();
        safeReleaseGain();
    }
}
