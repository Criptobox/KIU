package com.kiu.agent;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import java.io.File;

/* v2.11.3 · ACTUALIZAR DENTRO DE LA APP.
   Antes «Bajar el APK» abría el navegador (otra pantalla). Ahora el APK se baja con el mismo
   motor de descargas que los modelos GGUF (KiuDlTask: reanuda, muestra progreso) y se entrega
   al instalador de Android. Android solo acepta el APK si está firmado con la misma clave. */
public class KiuUpdate {
    /* Solo se instala lo bajado de los Releases de este repo. */
    static final String RELEASES = "https://github.com/Criptobox/KIU/releases/download/";

    public static File dir(Context c) {
        File base = null;
        try {
            base = c.getExternalFilesDir(null);
        } catch (Throwable ignored) {
        }
        if (base == null) {
            base = c.getFilesDir();
        }
        return new File(base, "updates");
    }

    /* devuelve «ok», «perm» (falta permitir instalar desde Kiu) o «err:motivo» */
    public static String install(Context c, String path) {
        try {
            File f = new File(path);
            File d = dir(c);
            if (!f.isFile() || !f.getName().toLowerCase().endsWith(".apk")
                    || f.getParentFile() == null
                    || !f.getParentFile().getCanonicalPath().equals(d.getCanonicalPath())) {
                return "err:archivo no valido";
            }
            if (Build.VERSION.SDK_INT >= 26 && !c.getPackageManager().canRequestPackageInstalls()) {
                Intent s = new Intent("android.settings.MANAGE_UNKNOWN_APP_SOURCES", Uri.parse("package:" + c.getPackageName()));
                s.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                c.startActivity(s);
                return "perm";
            }
            Uri uri = Uri.parse("content://" + c.getPackageName() + ".apk/" + Uri.encode(f.getName()));
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(uri, "application/vnd.android.package-archive");
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            c.startActivity(i);
            return "ok";
        } catch (Throwable t) {
            return "err:" + t;
        }
    }
}
