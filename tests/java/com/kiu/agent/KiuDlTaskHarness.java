package com.kiu.agent;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;

/**
 * Arnés de ejecución real de {@link KiuDlTask} (v2.14.2).
 *
 * <p>Por qué: la descarga de un modelo es la parte de la app donde un error
 * NO se ve hasta mucho después. Si el SHA-256 no se verifica, se instala un
 * modelo corrupto y el síntoma es "el motor no arranca" tres pasos más tarde,
 * sin relación aparente con la descarga. Y sin JDK, Android SDK ni emulador,
 * era imposible probarlo: {@code KiuDlTask} es Java puro (cero imports de
 * Android), así que corre en una JVM normal.
 *
 * <p>Cubre lo que el catálogo de modelos no puede dejar pasar:
 * <ul>
 *   <li>el magic de GGUF (un archivo que no es GGUF no es un modelo);</li>
 *   <li>el SHA-256 real del archivo (comparado con el conocido de antemano);</li>
 *   <li>un hash que NO coincide borra el archivo y deja el estado en error;</li>
 *   <li>un archivo que no se puede hashear NO se instala (v2.14.2: antes se
 *       renombraba como si estuviera bien).</li>
 * </ul>
 *
 * <p>Salida por stdout: una línea {@code FAIL <motivo>} por aserción que no se
 * cumplió, y al final {@code checks=N fails=M}. Sale con 1 si hubo algún fallo.
 */
public class KiuDlTaskHarness {

    private static int checks = 0;
    private static int fails = 0;

    private static void check(boolean cond, String what) {
        checks++;
        if (!cond) {
            fails++;
            System.out.println("FAIL " + what);
        }
    }

    /** Un directorio temporal limpio. */
    private static File dirTemporal(String prefijo) throws IOException {
        File f = File.createTempFile(prefijo, ".dir");
        f.delete();
        f.mkdirs();
        return f;
    }

    /** Escribe un archivo con el contenido exacto. */
    private static void escribir(File f, String contenido) throws IOException {
        FileOutputStream out = new FileOutputStream(f);
        try {
            out.write(contenido.getBytes("UTF-8"));
        } finally {
            out.close();
        }
    }

    public static void main(String[] args) throws Exception {
        MagiaGGUF();
        HashSHA256();
        FinalizaCuandoElHashCoincide();
        BorraCuandoElHashNoCoincide();
        RechazaLoQueNoEsGGUF();
        NoInstalaLoQueNoSePuedeVerificar();
        SinHashEsperadoSeAcepta();
        ElConstructorNormalizaElHash();

        System.out.println("checks=" + checks + " fails=" + fails);
        if (fails > 0) {
            System.exit(1);
        }
    }

    /* ---------- el magic de GGUF ---------- */
    private static void MagiaGGUF() throws IOException {
        File d = dirTemporal("kiu-magic-");

        File ok = new File(d, "ok.gguf");
        escribir(ok, "GGUF-version");
        check(KiuDlTask.ggufMagic(ok), "un archivo que empieza con GGUF tiene que pasar el magic");

        File no = new File(d, "no.gguf");
        escribir(no, "NOPE-version");
        check(!KiuDlTask.ggufMagic(no), "uno que NO empieza con GGUF no puede pasar por modelo");

        File corto = new File(d, "corto.gguf");
        escribir(corto, "GG");
        check(!KiuDlTask.ggufMagic(corto), "un archivo de menos de 4 bytes no puede ser GGUF");

        check(!KiuDlTask.ggufMagic(new File(d, "no-existe.gguf")),
            "un archivo que no existe no puede ser GGUF");
    }

    /* ---------- el SHA-256 ---------- */
    private static void HashSHA256() throws IOException {
        File d = dirTemporal("kiu-hash-");

        File kiu = new File(d, "kiu.txt");
        escribir(kiu, "Kiu");
        String h = KiuDlTask.hashOf(kiu);
        check(h.length() == 64, "el SHA-256 tiene que tener 64 caracteres, no " + h.length());
        check(h.equals("ae72ca91f6e7abf25e761e4c4ff78eef3bf14ced91c35af82e437b32170d5bc9"),
            "el SHA-256 de 'Kiu' tiene que ser el de verdad, no " + h);

        File vacio = new File(d, "vacio.txt");
        escribir(vacio, "");
        check(KiuDlTask.hashOf(vacio).equals("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"),
            "el SHA-256 del archivo vacío es el conocido");

        check(KiuDlTask.hashOf(null).equals(""), "un archivo nulo no tiene hash");
        check(KiuDlTask.hashOf(new File(d, "no-existe")).equals(""), "uno que no existe tampoco");
    }

    /* ---------- el camino feliz ---------- */
    private static void FinalizaCuandoElHashCoincide() throws IOException {
        File d = dirTemporal("kiu-ok-");
        File part = new File(d, "modelo.gguf.part");
        escribir(part, "GGUF");
        File out = new File(d, "modelo.gguf");

        KiuDlTask t = new KiuDlTask("id", "http://ejemplo/modelo", "modelo.gguf", d.getAbsolutePath(), "",
            "b83633aa785344791618f2fddf131b010ea04912a60430760b070bad293f65bd");
        boolean ok = t.finish(part, out, true);
        check(ok, "con el hash correcto tiene que finalizar bien");
        check("done".equals(t.state), "y dejar el estado en done, no en " + t.state);
        check(t.verified, "y quedar verificado");
        check(out.exists(), "el archivo final tiene que existir");
        check(!part.exists(), "y el .part no puede quedar tirado");
    }

    /* ---------- hash que no coincide ---------- */
    private static void BorraCuandoElHashNoCoincide() throws IOException {
        File d = dirTemporal("kiu-malo-");
        File part = new File(d, "modelo.gguf.part");
        escribir(part, "GGUF");
        File out = new File(d, "modelo.gguf");

        /* un hash de 64 caracteres que NO es el del contenido */
        String falso = "0000000000000000000000000000000000000000000000000000000000000000";
        KiuDlTask t = new KiuDlTask("id", "http://ejemplo/modelo", "modelo.gguf", d.getAbsolutePath(), "", falso);
        boolean ok = t.finish(part, out, true);
        check(!ok, "un hash que no coincide tiene que fallar");
        check("err".equals(t.state), "y dejar el estado en err, no en " + t.state);
        check(!part.exists(), "y borrar el archivo: un modelo corrupt no se queda en el disco");
        check(t.err != null && t.err.length() > 0, "y decir por qué");
        check(!t.verified, "y no quedar verificado");
    }

    /* ---------- lo que no es GGUF ---------- */
    private static void RechazaLoQueNoEsGGUF() throws IOException {
        File d = dirTemporal("kiu-fake-");
        File part = new File(d, "modelo.gguf.part");
        escribir(part, "NOPE");
        File out = new File(d, "modelo.gguf");

        KiuDlTask t = new KiuDlTask("id", "http://ejemplo/modelo", "modelo.gguf", d.getAbsolutePath(), "", "");
        boolean ok = t.finish(part, out, true);
        check(!ok, "un archivo que no es GGUF no puede terminarse como modelo");
        check("err".equals(t.state), "y dejar el estado en err, no en " + t.state);
        check(!part.exists(), "y borrarlo");
    }

    /* ---------- v2.14.2: lo que no se puede verificar no se instala ---------- */
    private static void NoInstalaLoQueNoSePuedeVerificar() throws IOException {
        File d = dirTemporal("kiu-ilegible-");
        /* un DIRECTORIO en lugar del archivo: hashFile no puede leerlo y
           devuelve "" (mismo camino que un error de I/O real) */
        File parte = new File(d, "ilegible.part");
        parte.mkdirs();
        File out = new File(d, "ilegible.bin");

        String hash = "b83633aa785344791618f2fddf131b010ea04912a60430760b070bad293f65bd";
        KiuDlTask t = new KiuDlTask("id", "http://ejemplo/modelo", "ilegible.bin", d.getAbsolutePath(), "", hash);
        boolean ok = t.finish(parte, out, false);
        check(!ok, "si no se puede hashear, NO se puede dar por bueno: tiene que fallar");
        check("err".equals(t.state), "y dejar el estado en err, no en " + t.state);
        check(!t.verified, "y no quedar verificado");
        check(t.err != null && t.err.length() > 0, "y decir por qué");
    }

    /* ---------- sin hash en el catálogo ---------- */
    private static void SinHashEsperadoSeAcepta() throws IOException {
        File d = dirTemporal("kiu-sin-hash-");
        File part = new File(d, "modelo.bin.part");
        escribir(part, "cualquier cosa");
        File out = new File(d, "modelo.bin");

        KiuDlTask t = new KiuDlTask("id", "http://ejemplo/modelo", "modelo.bin", d.getAbsolutePath(), "", "");
        boolean ok = t.finish(part, out, false);
        check(ok, "sin hash en el catálogo la descarga se acepta (no hay contra qué comparar)");
        check("done".equals(t.state), "y queda en done");
        check(!t.verified, "pero sin marcar como verificada");
    }

    /* ---------- el constructor normaliza el hash ---------- */
    private static void ElConstructorNormalizaElHash() {
        KiuDlTask t = new KiuDlTask("id", "u", "n", "d", "a", "  B83633AA785344791618F2FDDF131B010EA04912A60430760B070BAD293F65BD  ");
        check(t.expect.equals("b83633aa785344791618f2fddf131b010ea04912a60430760b070bad293f65bd"),
            "el hash esperado se normaliza (minúsculas, sin espacios), no " + t.expect);
    }
}
