package com.kiu.agent;

/** Arnés de ejecución real de {@link WakeDedupe} (v2.23.0). Salida: FAIL <motivo> y «checks=N fails=M». */
public class WakeDedupeHarness {
    private static int checks = 0, fails = 0;
    private static void check(boolean c, String what) { checks++; if (!c) { fails++; System.out.println("FAIL " + what); } }

    public static void main(String[] a) {
        WakeDedupe d = new WakeDedupe(4000);
        check(!d.esRepetido("poné una alarma", 0), "la primera frase nunca es repetida, ni con el reloj en 0");
        check(d.esRepetido("poné una alarma", 1000), "misma frase a 1 s: repetida");
        check(d.esRepetido("  PONÉ una ALARMA ", 3999), "mayúsculas y espacios no la hacen distinta");
        check(!d.esRepetido("poné una alarma", 4000), "justo en la ventana (4000 ms desde la primera) ya vale");
        check(!d.esRepetido("qué hora es", 4100), "otra frase nunca es repetida");
        check(!d.esRepetido("poné una alarma", 4200), "alternar frases rompe la cadena");
        check(!d.esRepetido(null, 9000), "null no revienta");
        check(d.esRepetido(null, 9001), "null repetido sí se detecta");
        check(!d.esRepetido("hola", 20000) && !d.esRepetido("hola", 24001), "pasada la ventana vuelve a valer");
        System.out.println("checks=" + checks + " fails=" + fails);
        System.exit(fails == 0 ? 0 : 1);
    }
}
