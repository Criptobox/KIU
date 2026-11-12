package com.kiu.agent;

/**
 * Escape de texto para meterlo dentro de un string entre comillas dobles que Java arma como
 * JSON o como código JS y manda al WebView (v2.23.2).
 *
 * <p>Antes había cuatro versiones distintas (KiuGenJob, KiuStream, KiuDownload, KiuVoskInstall):
 * una no escapaba saltos de línea (un mensaje de error con «\n» rompía el callback entero) y otra
 * cambiaba « " » por « ' » (perdía información). Esta es la única, y es JSON válido Y literal JS
 * válido: escapa «\», «"», todos los caracteres de control (0x00–0x1F, 0x7F) y U+2028/U+2029.
 * Lo que sale, evaluado en JS, devuelve exactamente el texto de entrada; no hay forma de cerrar
 * el string ni de inyectar código.
 *
 * <p>Java puro (sin Android): lo ejecuta un arnés y sus resultados se evalúan en Node.
 */
final class JsEscape {
    private JsEscape() { }

    static String esc(String s) {
        if (s == null) return "";
        StringBuilder b = new StringBuilder(s.length() + 16);
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '\\': b.append("\\\\"); break;
                case '"': b.append("\\\""); break;
                case '\n': b.append("\\n"); break;
                case '\r': b.append("\\r"); break;
                case '\t': b.append("\\t"); break;
                case '\b': b.append("\\b"); break;
                case '\f': b.append("\\f"); break;
                default:
                    if (c < 0x20 || c == 0x7F || c == 0x2028 || c == 0x2029) {
                        b.append(String.format("\\u%04x", (int) c));
                    } else {
                        b.append(c);
                    }
            }
        }
        return b.toString();
    }
}
