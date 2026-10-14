package com.kiu.agent;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

/* loaded from: classes.dex */
public class BootReceiver extends BroadcastReceiver {
    @Override // android.content.BroadcastReceiver
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        /* v2.7.3: ademas del arranque, al ACTUALIZAR la app Android borra todas las alarmas
           programadas (recordatorios y resumen matutino se perdian hasta abrir la app), y un
           cambio de hora/zona horaria desplaza las alarmas absolutas. */
        boolean boot = "android.intent.action.BOOT_COMPLETED".equals(action)
                || "android.intent.action.MY_PACKAGE_REPLACED".equals(action);
        boolean timeChange = "android.intent.action.TIME_SET".equals(action)
                || "android.intent.action.TIMEZONE_CHANGED".equals(action);
        if (!boot && !timeChange) {
            return;
        }
        Alarms.rescheduleAll(context);
        /* v2.5.0 (sección 4-b): el resumen matutino vuelve a armarse tras reiniciar */
        try { MorningReceiver.rescheduleIfOn(context); } catch (Exception ignored) { }
        if (boot && context.getSharedPreferences("kiu_native", 0).getBoolean("wake", false)) {
            try {
                Intent intent2 = new Intent(context, (Class<?>) KiuService.class);
                if (Build.VERSION.SDK_INT >= 26) {
                    context.startForegroundService(intent2);
                } else {
                    context.startService(intent2);
                }
            } catch (Exception unused) {
            }
        }
    }
}
