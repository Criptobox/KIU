package com.kiu.agent;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.Base64;

/** Arnés de {@link JsEscape} (v2.23.2): lee textos en base64 (uno por línea, stdin) y escribe su escape (una línea cada uno). */
public class JsEscapeHarness {
    public static void main(String[] a) throws Exception {
        BufferedReader r = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
        String line;
        StringBuilder out = new StringBuilder();
        while ((line = r.readLine()) != null) {
            String texto = new String(Base64.getDecoder().decode(line.trim()), StandardCharsets.UTF_8);
            out.append(Base64.getEncoder().encodeToString(JsEscape.esc(texto).getBytes(StandardCharsets.UTF_8))).append('\n');
        }
        System.out.print(out);
    }
}
