package com.kiu.agent;

/** Arnés de ejecución real de {@link ProxyPolicy} (v2.23.0). Salida: FAIL <motivo> y «checks=N fails=M». */
public class ProxyPolicyHarness {
    private static int checks = 0, fails = 0;
    private static void check(boolean c, String what) { checks++; if (!c) { fails++; System.out.println("FAIL " + what); } }

    public static void main(String[] a) {
        /* --- claves atadas a su proveedor --- */
        check(ProxyPolicy.mayInject("openai", "api.openai.com"), "openai → su host");
        check(ProxyPolicy.mayInject("OpenAI", "API.OPENAI.COM"), "mayúsculas no importan");
        check(!ProxyPolicy.mayInject("openai", "api.groq.com"), "la clave de openai NO va a groq");
        check(!ProxyPolicy.mayInject("groq", "api.openai.com"), "la clave de groq NO va a openai");
        check(!ProxyPolicy.mayInject("openai", "api.openai.com.evil.com"), "sufijo malicioso: api.openai.com.evil.com");
        check(!ProxyPolicy.mayInject("openai", "evilapi.openai.com"), "evilapi.openai.com no es api.openai.com");
        check(!ProxyPolicy.mayInject("openai", "evil.com"), "host ajeno");
        check(!ProxyPolicy.mayInject("openai", null) && !ProxyPolicy.mayInject("openai", ""), "host vacío o null");
        check(ProxyPolicy.mayInject("openrouter", "openrouter.ai"), "openrouter → su host");
        check(ProxyPolicy.mayInject("openrouter", "eu.openrouter.ai"), "subdominio legítimo");
        /* --- proveedor del usuario ("otro") --- */
        check(ProxyPolicy.mayInject("mi-servidor", "192.168.1.10"), "proveedor propio → su servidor");
        check(!ProxyPolicy.mayInject("mi-servidor", "api.openai.com"), "proveedor propio NO exfiltra hacia un proveedor conocido");
        check(!ProxyPolicy.mayInject("mi-servidor", "api.groq.com"), "idem groq");
        check(ProxyPolicy.mayInject(null, "mi.servidor.com"), "id null se trata como propio");
        /* --- qué URL puede abrir el proxy --- */
        check(ProxyPolicy.allowed("https://api.openai.com/v1/chat"), "https cualquiera");
        check(!ProxyPolicy.allowed("http://api.openai.com/v1"), "http a Internet: no (iría en claro)");
        check(ProxyPolicy.allowed("http://localhost:1234/v1"), "localhost");
        check(ProxyPolicy.allowed("http://127.0.0.1:8080/"), "127.0.0.1");
        check(ProxyPolicy.allowed("http://192.168.1.10:1234/v1"), "LAN 192.168");
        check(ProxyPolicy.allowed("http://10.0.0.5/"), "LAN 10.");
        check(ProxyPolicy.allowed("http://172.16.0.1/") && ProxyPolicy.allowed("http://172.31.255.1/"), "LAN 172.16–31");
        check(!ProxyPolicy.allowed("http://172.32.0.1/") && !ProxyPolicy.allowed("http://172.15.0.1/"), "172.15 y 172.32 son públicas");
        check(!ProxyPolicy.allowed("http://10.evil.com/"), "10.evil.com no es LAN");
        check(!ProxyPolicy.allowed("http://192.168.1.10.evil.com/"), "192.168.1.10.evil.com no es LAN");
        check(!ProxyPolicy.allowed("http://999.1.1.1/"), "IPv4 inválida");
        check(!ProxyPolicy.allowed("http://8.8.8.8/"), "IP pública por http");
        check(ProxyPolicy.allowed("http://miservidor.local:11434/"), "nombre .local");
        check(!ProxyPolicy.allowed("file:///data/data/com.kiu.agent/shared_prefs/x.xml"), "file:// jamás");
        check(!ProxyPolicy.allowed("ftp://192.168.1.1/") && !ProxyPolicy.allowed("javascript:alert(1)"), "otros esquemas");
        check(!ProxyPolicy.allowed("https://") && !ProxyPolicy.allowed("no es una url") && !ProxyPolicy.allowed(null), "basura");
        check(!ProxyPolicy.allowed("http://192.168.1.10@evil.com/"), "userinfo engañoso: el host real es evil.com");
        System.out.println("checks=" + checks + " fails=" + fails);
        System.exit(fails == 0 ? 0 : 1);
    }
}
