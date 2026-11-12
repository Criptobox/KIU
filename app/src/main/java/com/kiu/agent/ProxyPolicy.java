package com.kiu.agent;

import java.net.URL;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Política del proxy de API (v2.23.0), extraída de {@link KiuApiProxy} sin cambiar su lógica:
 * qué host puede recibir la clave de qué proveedor y qué URL puede abrir el proxy.
 * Java puro (sin Android) para poder probarla en una JVM con direcciones de ataque.
 */
final class ProxyPolicy {
    private ProxyPolicy() { }

    /* id de proveedor (el mismo que usa js/app/state.js PROV) → hosts que le pertenecen.
       Un host claimado por un proveedor NO puede recibir la clave de otro. */
    private static final String[][] PROVIDER_HOSTS = {
            {"openai", "api.openai.com"},
            {"gemini", "generativelanguage.googleapis.com"},
            {"groq", "api.groq.com"},
            {"deepseek", "api.deepseek.com"},
            {"openrouter", "openrouter.ai"},
            {"kimi", "api.moonshot.ai"},
            {"nvidia", "integrate.api.nvidia.com"},
    };

    /* ¿Este placeholder puede viajar a este host? */
    static boolean mayInject(String providerId, String host) {
        String mine = providerId == null ? "" : providerId.toLowerCase();
        String[] mineHosts = hostsOf(mine);
        if (mineHosts != null) return hostMatches(host, mineHosts);   /* conocido: ata o suelta */
        /* proveedor del usuario: se inyecta, salvo que el host sea de otro conocido */
        for (String[] row : PROVIDER_HOSTS) {
            if (hostMatches(host, new String[]{row[1]})) return false;
        }
        return true;
    }

    private static String[] hostsOf(String providerId) {
        for (String[] row : PROVIDER_HOSTS) {
            if (row[0].equalsIgnoreCase(providerId)) return new String[]{row[1]};
        }
        return null;
    }

    private static boolean hostMatches(String host, String[] hosts) {
        if (host == null || host.isEmpty()) return false;
        for (String h : hosts) {
            if (host.equalsIgnoreCase(h) || host.toLowerCase().endsWith("." + h)) return true;
        }
        return false;
    }

    private static final Pattern IPV4 = Pattern.compile("^(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})$");

    /* v2.7.1: antes bastaba host.startsWith("10.") -> "http://10.evil.com" pasaba como LAN y salia en claro.
       Ahora solo cuentan IPv4 literales privadas reales o nombres .local/.lan de UNA etiqueta. */
    static boolean allowed(String url) {
        try {
            URL u = new URL(url);
            String proto = u.getProtocol();
            String host = u.getHost() == null ? "" : u.getHost().toLowerCase();
            if ("https".equals(proto)) return !host.isEmpty();
            if (!"http".equals(proto)) return false;
            if ("localhost".equals(host) || "::1".equals(host) || "[::1]".equals(host)) return true;
            if (host.endsWith(".local") || host.endsWith(".lan")) return true; /* TLDs no enrutables en Internet */
            Matcher m = IPV4.matcher(host);
            if (!m.matches()) return false;
            int a = Integer.parseInt(m.group(1)), b = Integer.parseInt(m.group(2));
            int c = Integer.parseInt(m.group(3)), d = Integer.parseInt(m.group(4));
            if (a > 255 || b > 255 || c > 255 || d > 255) return false;
            return a == 127 || a == 10 || (a == 192 && b == 168) || (a == 172 && b >= 16 && b <= 31);
        } catch (Throwable th) {
            return false;
        }
    }
}
