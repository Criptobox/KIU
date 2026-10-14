package com.kiu.agent;

import android.app.Activity;
import android.app.ActivityManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.IntentFilter;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraManager;
import android.media.ToneGenerator;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.StatFs;
import android.os.SystemClock;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.provider.CalendarContract;
import android.speech.RecognitionListener;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import android.text.TextUtils;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import androidx.webkit.WebViewAssetLoader;
import android.widget.TextView;
import android.widget.Toast;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

/* loaded from: classes.dex */
public class MainActivity extends Activity {
    private static final Map<String, String> APP_MAP;
    private static final int REQ_CONTACTS = 4244;
    private static final int REQ_MIC = 4242;
    private static final int REQ_NOTIF = 4243;
    public static volatile boolean SPEAKING;
    /* v2.4.0: JSON de la copia en vuelo entre kiuDataExport y onActivityResult(7102) */
    volatile String pendingExport = null;
    static MainActivity inst;
    private SpeechRecognizer recognizer;
    private TextToSpeech tts;
    /* visible-de-paquete: KiuJsPost (mismo paquete) necesita inyectar JS */
    WebView web;
    /* v2.3.0 (sección 2 · seguridad): sirve la UI por https://appassets.androidplatform.net
       (origen seguro gestionado por androidx.webkit) en vez de file:// — así la WebView
       no necesita permisos universales de lectura de archivos. */
    WebViewAssetLoader assetLoader;
    static final String ASSET_BASE = "https://appassets.androidplatform.net/assets/";
    private boolean ttsReady = false;
    private float ttsRate = 1.0f;
    private boolean pendingListen = false;
    private boolean pendingWake = false;
    private volatile boolean handsFree = true;
    private boolean convArmed = false;
    private long lastConvBeat = 0;
    private volatile boolean resumed = true;
    private String pendingCmd = null;
    private boolean pageReady = false;
    private float ttsPitch = 1.0f;
    private final Handler tHandler = new Handler(Looper.getMainLooper());
    private Runnable tRun = null;
    private final Runnable convOpen = new Runnable() { // from class: com.kiu.agent.MainActivity.4
        @Override // java.lang.Runnable
        public void run() {
            MainActivity.this.openConvMic();
        }
    };

    private void fatalUi(Throwable th) {
        try {
            TextView textView = new TextView(this);
            textView.setGravity(17);
            textView.setTextSize(14.0f);
            textView.setBackgroundColor(-16777216);
            textView.setTextColor(-1);
            textView.setPadding(48, 32, 48, 32);
            textView.setText("Kiu no pudo iniciar\n\n" + th.toString() + "\n\n(Enviar captura de esta pantalla al soporte)");
            setContentView(textView);
        } catch (Throwable th2) {
        }
    }

    @Override // android.app.Activity
    protected void onActivityResult(int i, int i2, Intent intent) {
        Uri data;
        super.onActivityResult(i, i2, intent);
        if (i2 != -1 || intent == null || (data = intent.getData()) == null) {
            return;
        }
        if (i == 7101) {
            KiuImport.begin(this, data);
            return;
        }
        /* v2.4.0 (sección 1): copia de seguridad completa vía SAF */
        if (i == 7102) {
            writeDataBackup(data);
            return;
        }
        if (i == 7103) {
            readDataBackup(data);
            return;
        }
        /* v2.5.0 (sección 4-a): skill instalable desde archivo */
        if (i == 7104) {
            readSkillFile(data);
        }
    }

    /* v2.5.0: lee el JSON del skill (SAF) y se lo entrega a KiuSkills */
    private void readSkillFile(Uri uri) {
        try {
            java.io.InputStream is = getContentResolver().openInputStream(uri);
            java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            int cap = 512 * 1024;
            while ((n = is.read(buf)) > 0) {
                bos.write(buf, 0, n);
                if (bos.size() > cap) throw new IllegalStateException("skill demasiado grande");
            }
            is.close();
            String json = new String(bos.toByteArray(), "UTF-8");
            new Thread(new KiuJsPost("window.kiuSkillInstall && window.kiuSkillInstall(" + jsonQuote(json) + ");")).start();
        } catch (Throwable t) {
            String msg = "No pude leer el skill: " + t.getMessage();
            new Thread(new KiuJsPost("window.App && App.toast(" + jsq(msg) + ");")).start();
        }
    }

    /* v2.4.0: escribe el JSON de la copia (kiuDataExport) en el documento elegido */
    private void writeDataBackup(Uri uri) {
        String json = this.pendingExport;
        this.pendingExport = null;
        boolean ok = false;
        String msg;
        try {
            if (json != null && json.length() > 2) {
                java.io.OutputStream os = getContentResolver().openOutputStream(uri, "wt");
                if (os != null) {
                    os.write(json.getBytes("UTF-8"));
                    os.flush();
                    os.close();
                    ok = true;
                }
            }
        } catch (Throwable t) {
            ok = false;
        }
        msg = ok ? "Copia completa guardada ✓ (ajustes, memoria, chats, documentos)"
                 : "No pude escribir la copia en el archivo elegido";
        new Thread(new KiuJsPost("window.App && App.toast(" + jsq(msg) + ");")).start();
    }

    /* v2.4.0: lee el JSON de la copia y se lo entrega a la UI para restaurar */
    private void readDataBackup(Uri uri) {
        try {
            java.io.InputStream is = getContentResolver().openInputStream(uri);
            java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[65536];
            int n;
            int cap = 30 * 1048576;
            while ((n = is.read(buf)) > 0) {
                bos.write(buf, 0, n);
                if (bos.size() > cap) throw new IllegalStateException("copia demasiado grande");
            }
            is.close();
            String json = new String(bos.toByteArray(), "UTF-8");
            new Thread(new KiuJsPost("window.kiuDataRestore && window.kiuDataRestore(" + jsonQuote(json) + ");")).start();
        } catch (Throwable t) {
            String msg = "No pude leer la copia: " + t;
            new Thread(new KiuJsPost("window.App && App.toast(" + jsq(msg) + ");")).start();
        }
    }

    private static String jsq(String s) {
        return jsonQuote(s == null ? "" : s);
    }

    private static String jsonQuote(String s) {
        try {
            return org.json.JSONObject.quote(s == null ? "" : s);
        } catch (Throwable t) {
            return "\"\"";
        }
    }

    @Override // android.app.Activity
    protected void onCreate(Bundle bundle) {
        super.onCreate(bundle);
        try {
            getWindow().setStatusBarColor(-16777216);
            getWindow().setNavigationBarColor(-16777216);
            WebView webView = new WebView(this);
            this.web = webView;
            setContentView(webView);
            WebSettings settings = this.web.getSettings();
            settings.setJavaScriptEnabled(true);
            settings.setDomStorageEnabled(true);
            settings.setAllowFileAccess(true);
            settings.setAllowContentAccess(true);
            settings.setAllowFileAccessFromFileURLs(false);
            /* v2.3.0: el origen nuevo es https (appassets.androidplatform.net); ya no
               hace falta —y no conviene— el acceso universal desde file://. Se deja
               allowFileAccess=true SOLO para el ferry único de migración de datos. */
            settings.setAllowUniversalAccessFromFileURLs(false);
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
            settings.setMediaPlaybackRequiresUserGesture(false);
            settings.setCacheMode(-1);
            settings.setTextZoom(100);
            this.web.setBackgroundColor(-16777216);
            this.web.setOverScrollMode(2);
            this.web.setWebViewClient(new WebViewClient() { // from class: com.kiu.agent.MainActivity.1
                /* v2.3.0: cada petición (html/js/css/img/fetch a assets) pasa por el
                   AssetLoader; lo que no es del origen seguro sigue su curso. */
                @Override // android.webkit.WebViewClient
                public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                    try {
                        WebResourceResponse r = assetLoader.shouldInterceptRequest(request.getUrl());
                        if (r != null) return r;
                    } catch (Throwable ignored) { }
                    return null;
                }

                @Override // android.webkit.WebViewClient
                public boolean shouldOverrideUrlLoading(WebView webView2, String str) {
                    if (str == null) return false;
                    if (str.startsWith("appassets.androidplatform.net") || Uri.parse(str).getHost() != null
                            && "appassets.androidplatform.net".equals(Uri.parse(str).getHost())) return false;
                    if (str.startsWith("file://")) return true; /* sin navegación file:// */
                    try {
                        MainActivity.this.startActivity(new Intent("android.intent.action.VIEW", Uri.parse(str)));
                        return true;
                    } catch (Exception unused) {
                        return true;
                    }
                }
            });
            this.web.setWebChromeClient(new WebChromeClient() { // from class: com.kiu.agent.MainActivity.2
                @Override // android.webkit.WebChromeClient
                public void onPermissionRequest(final PermissionRequest permissionRequest) {
                    MainActivity.this.runOnUiThread(new Runnable() { // from class: com.kiu.agent.MainActivity.2.1
                        @Override // java.lang.Runnable
                        public void run() {
                            if (MainActivity.this.checkSelfPermission("android.permission.RECORD_AUDIO") == 0) {
                                /* v2.7.2: solo audio, y solo desde nuestro origen; nunca camara u otros recursos */
                                java.util.ArrayList<String> okRes = new java.util.ArrayList<String>();
                                boolean ownOrigin = permissionRequest.getOrigin() != null
                                        && "appassets.androidplatform.net".equals(permissionRequest.getOrigin().getHost());
                                if (ownOrigin) {
                                    for (String r : permissionRequest.getResources()) {
                                        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) okRes.add(r);
                                    }
                                }
                                if (okRes.isEmpty()) permissionRequest.deny();
                                else permissionRequest.grant(okRes.toArray(new String[0]));
                            } else {
                                permissionRequest.deny();
                            }
                        }
                    });
                }
            });
            this.web.addJavascriptInterface(new Bridge(), "KiuBridge");
            inst = this;
            initTts();
            Alarms.rescheduleAll(this);
            if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission("android.permission.POST_NOTIFICATIONS") != 0) {
                requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, REQ_NOTIF);
            }
            /* v2.3.0: primer arranque de la app nueva → un único pase "ferry" por el
               origen viejo (file://) para llevar localStorage al origen seguro; después
               se sirve todo por https://appassets.androidplatform.net para siempre. */
            assetLoader = new WebViewAssetLoader.Builder()
                    .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                    .build();
            if (getSharedPreferences("kiu_ferry", 0).getBoolean("done", false)) {
                this.web.loadUrl(ASSET_BASE + "www/index.html");
            } else {
                this.web.loadUrl("file:///android_asset/www/index.html?ferry=1");
            }
            handleExtras(getIntent());
        } catch (Throwable th) {
            fatalUi(th);
        }
    }

    private void handleExtras(Intent intent) {
        String stringExtra;
        if (intent == null || (stringExtra = intent.getStringExtra("cmd")) == null || stringExtra.trim().isEmpty()) {
            return;
        }
        intent.removeExtra("cmd");
        if (this.pageReady) {
            js("nexoWakeCmd(" + jsStr(stringExtra) + ")");
            return;
        }
        this.pendingCmd = stringExtra;
    }

    private void initTts() {
        this.tts = new TextToSpeech(this, new TextToSpeech.OnInitListener() { // from class: com.kiu.agent.MainActivity.3
            @Override // android.speech.tts.TextToSpeech.OnInitListener
            public void onInit(int i) {
                if (i == 0) {
                    Locale[] localeArr = {new Locale("es", "AR"), new Locale("es", "MX"), new Locale("es", "ES"), new Locale("es")};
                    for (int i2 = 0; i2 < 4; i2++) {
                        int language = MainActivity.this.tts.setLanguage(localeArr[i2]);
                        if (language != -1 && language != -2) {
                            break;
                        }
                    }
                    MainActivity.this.pickBestVoice();
                    MainActivity.this.tts.setSpeechRate(MainActivity.this.ttsRate);
                    MainActivity.this.tts.setPitch(MainActivity.this.ttsPitch);
                    MainActivity.this.tts.setOnUtteranceProgressListener(new UtteranceProgressListener() { // from class: com.kiu.agent.MainActivity.3.1
                        @Override // android.speech.tts.UtteranceProgressListener
                        public void onStart(String str) {
                            MainActivity.SPEAKING = true;
                            MainActivity.this.js("nexoTtsStart()");
                        }

                        @Override // android.speech.tts.UtteranceProgressListener
                        public void onDone(String str) {
                            MainActivity.SPEAKING = false;
                            MainActivity.this.js("nexoTtsDone()");
                            KiuService.resumeSoon();
                            MainActivity.this.lastConvBeat = SystemClock.elapsedRealtime();
                            if (MainActivity.this.handsFree && MainActivity.this.resumed) {
                                MainActivity.this.tHandler.removeCallbacks(MainActivity.this.convOpen);
                                MainActivity.this.tHandler.postDelayed(MainActivity.this.convOpen, 700L);
                            }
                        }

                        @Override // android.speech.tts.UtteranceProgressListener
                        public void onError(String str) {
                            MainActivity.SPEAKING = false;
                            MainActivity.this.js("nexoTtsDone()");
                            KiuService.resumeSoon();
                            MainActivity.this.lastConvBeat = SystemClock.elapsedRealtime();
                            if (MainActivity.this.handsFree && MainActivity.this.resumed) {
                                MainActivity.this.tHandler.removeCallbacks(MainActivity.this.convOpen);
                                MainActivity.this.tHandler.postDelayed(MainActivity.this.convOpen, 700L);
                            }
                        }
                    });
                    MainActivity.this.ttsReady = true;
                }
            }
        });
    }

    /* JADX INFO: Access modifiers changed from: private */
    public void pickBestVoice() {
        try {
            Set<Voice> voices = this.tts.getVoices();
            if (voices != null && !voices.isEmpty()) {
                Voice voice = null;
                int i = -1;
                for (Voice voice2 : voices) {
                    Locale locale = voice2.getLocale();
                    if (locale != null && locale.getLanguage().startsWith("es")) {
                        String lowerCase = voice2.getName().toLowerCase(Locale.US);
                        int i2 = lowerCase.contains("network") ? 10 : 0;
                        if (lowerCase.contains("neural") || lowerCase.contains("journey") || lowerCase.contains("studio") || lowerCase.contains("wave")) {
                            i2 += 6;
                        }
                        if (lowerCase.contains("google")) {
                            i2 += 5;
                        }
                        if (lowerCase.contains("female")) {
                            i2++;
                        }
                        String country = locale.getCountry() == null ? "" : locale.getCountry();
                        if ("AR".equals(country)) {
                            i2 += 3;
                        } else if ("MX".equals(country) || "ES".equals(country) || "US".equals(country)) {
                            i2 += 2;
                        }
                        if (voice2.getQuality() >= 400) {
                            i2 += 4;
                        } else if (voice2.getQuality() >= 300) {
                            i2++;
                        }
                        if (i2 > i) {
                            voice = voice2;
                            i = i2;
                        }
                    }
                }
                if (voice != null) {
                    this.tts.setVoice(voice);
                }
            }
        } catch (Exception unused) {
        }
    }

    /* JADX INFO: Access modifiers changed from: private */
    public void openConvMic() {
        if (this.handsFree && this.resumed && !SPEAKING) {
            startSpeech();
        }
    }

    /* JADX INFO: Access modifiers changed from: private */
    public static boolean convWindowOpen(long j) {
        return SystemClock.elapsedRealtime() - j < 14000;
    }

    /* JADX INFO: Access modifiers changed from: private */
    public void timerFire(String str) {
        this.tRun = null;
        new Thread(new Runnable() { // from class: com.kiu.agent.MainActivity.5
            @Override // java.lang.Runnable
            public void run() {
                try {
                    ToneGenerator toneGenerator = new ToneGenerator(4, 100);
                    for (int i = 0; i < 3; i++) {
                        toneGenerator.startTone(28, 320);
                        try {
                            Thread.sleep(480L);
                        } catch (Exception unused) {
                        }
                    }
                    toneGenerator.release();
                } catch (Exception unused2) {
                }
            }
        }).start();
        vibrateNow(600);
        try {
            ReminderReceiver.notify(this, "Temporizador: " + str);
        } catch (Exception unused) {
        }
        MainActivity mainActivity = inst;
        if (mainActivity != null) {
            mainActivity.js("nexoTimerDone(" + jsStr(str) + ")");
        }
    }

    private void vibrateNow(int i) {
        try {
            Vibrator vibrator = (Vibrator) getSystemService("vibrator");
            if (vibrator == null) {
                return;
            }
            if (Build.VERSION.SDK_INT >= 26) {
                vibrator.vibrate(VibrationEffect.createOneShot(i, -1));
            } else {
                vibrator.vibrate(i);
            }
        } catch (Exception unused) {
        }
    }

    /* v2.7.3: antirrebote — el mismo comando dos veces en 4 s (motores Vosk/SpeechRecognizer
       que repiten el final) no se ejecuta dos veces. */
    private static String lastWakeCmd = "";
    private static long lastWakeAt = 0;
    private static synchronized boolean wakeDup(String s) {
        long now = SystemClock.elapsedRealtime();
        String k = s == null ? "" : s.trim().toLowerCase(Locale.ROOT);
        if (k.equals(lastWakeCmd) && now - lastWakeAt < 4000) return true;
        lastWakeCmd = k;
        lastWakeAt = now;
        return false;
    }

    static void wakeDeliver(Context context, String str) {
        if (wakeDup(str)) return;
        MainActivity mainActivity = inst;
        if (mainActivity != null) {
            mainActivity.js("nexoWakeCmd(" + mainActivity.jsStr(str) + ")");
            return;
        }
        try {
            Intent intent = new Intent(context, (Class<?>) MainActivity.class);
            intent.addFlags(805306368);
            intent.putExtra("cmd", str);
            context.startActivity(intent);
        } catch (Exception unused) {
        }
    }

    static void wakePing(Context context) {
        MainActivity mainActivity = inst;
        if (mainActivity != null) {
            mainActivity.js("nexoWakeHit()");
        }
    }

    /* JADX INFO: Access modifiers changed from: private */
    public void startWakeNow() {
        runOnUiThread(new Runnable() { // from class: com.kiu.agent.MainActivity.6
            @Override // java.lang.Runnable
            public void run() {
                // wake word 100% local (Vosk): sin Google, sin red
                SharedPreferences sp = MainActivity.this.getSharedPreferences("kiu_native", 0);
                if (sp.getBoolean("wwLocal", false) && WakeWordEngine.modelPresent(MainActivity.this)) {
                    boolean ok = WakeWordEngine.get().start(MainActivity.this);
                    MainActivity.this.getSharedPreferences("kiu_native", 0).edit().putBoolean("wake", ok).apply();
                    MainActivity.this.js("nexoWakeState(" + ok + ")");
                    return;
                }
                if (Build.VERSION.SDK_INT >= 33 && MainActivity.this.checkSelfPermission("android.permission.POST_NOTIFICATIONS") != 0) {
                    MainActivity.this.requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, MainActivity.REQ_NOTIF);
                    return;
                }
                try {
                    Intent intent = new Intent(MainActivity.this, (Class<?>) KiuService.class);
                    if (Build.VERSION.SDK_INT >= 26) {
                        MainActivity.this.startForegroundService(intent);
                    } else {
                        MainActivity.this.startService(intent);
                    }
                    MainActivity.this.getSharedPreferences("kiu_native", 0).edit().putBoolean("wake", true).apply();
                    MainActivity.this.js("nexoWakeState(true)");
                } catch (Exception unused) {
                    MainActivity.this.js("nexoWakeState(false)");
                }
            }
        });
    }

    static {
        HashMap hashMap = new HashMap();
        APP_MAP = hashMap;
        hashMap.put("whatsapp", "com.whatsapp");
        hashMap.put("wsp", "com.whatsapp");
        hashMap.put("instagram", "com.instagram.android");
        hashMap.put("insta", "com.instagram.android");
        hashMap.put("facebook", "com.facebook.katana");
        hashMap.put("youtube", "com.google.android.youtube");
        hashMap.put("spotify", "com.spotify.music");
        hashMap.put("gmail", "com.google.android.gm");
        hashMap.put("correo", "com.google.android.gm");
        hashMap.put("mapas", "com.google.android.apps.maps");
        hashMap.put("chrome", "com.android.chrome");
        hashMap.put("telegram", "org.telegram.messenger");
        hashMap.put("tiktok", "com.zhiliaoapp.musically");
        hashMap.put("netflix", "com.netflix.mediaclient");
        hashMap.put("twitter", "com.twitter.android");
        hashMap.put("play store", "com.android.vending");
        hashMap.put("tienda", "com.android.vending");
        hashMap.put("reloj", "com.google.android.deskclock");
        hashMap.put("calendario", "com.google.android.calendar");
        hashMap.put("agenda", "com.google.android.calendar");
        hashMap.put("calculadora", "com.google.android.calculator");
        hashMap.put("notas", "com.google.android.keep");
        hashMap.put("musica", "com.google.android.apps.youtube.music");
    }

    static String javaNorm(String str) {
        if (str == null) {
            return "";
        }
        String trim = str.toLowerCase().trim();
        StringBuilder sb = new StringBuilder(trim.length());
        for (int i = 0; i < trim.length(); i++) {
            char charAt = trim.charAt(i);
            switch (charAt) {
                case 224:
                case 225:
                case 228:
                    charAt = 'a';
                    break;
                case 232:
                case 233:
                case 235:
                    charAt = 'e';
                    break;
                case 236:
                case 237:
                case 239:
                    charAt = 'i';
                    break;
                case 241:
                    charAt = 'n';
                    break;
                case 242:
                case 243:
                case 246:
                    charAt = 'o';
                    break;
                case 249:
                case 250:
                case 252:
                    charAt = 'u';
                    break;
            }
            if (Character.isLetterOrDigit(charAt) || charAt == ' ') {
                sb.append(charAt);
            }
        }
        return sb.toString().replaceAll("\\s+", " ").trim();
    }

    private class Bridge {
        @JavascriptInterface
        public String decSec(String str) {
            try {
                return KiuCrypto.dec(str);
            } catch (Throwable th) {
                return "";
            }
        }

        @JavascriptInterface
        public void dlCancel(String str) {
            try {
                KiuDownload.cancel(str);
            } catch (Throwable th) {
            }
        }

        @JavascriptInterface
        public boolean dlDel(String str) {
            try {
                return KiuDownload.del(MainActivity.this, str);
            } catch (Throwable th) {
                return false;
            }
        }

        @JavascriptInterface
        public long dlFree() {
            try {
                return KiuDownload.free(MainActivity.this);
            } catch (Throwable th) {
                return 0L;
            }
        }

        @JavascriptInterface
        public String dlList() {
            try {
                return KiuDownload.list(MainActivity.this);
            } catch (Throwable th) {
                return "[]";
            }
        }

        @JavascriptInterface
        public String dlStart(String str, String str2, String str3) {
            try {
                return KiuDownload.start(MainActivity.this, str, str2, str3);
            } catch (Throwable th) {
                return "{\"st\":\"error\",\"err\":\"no se pudo iniciar\"}";
            }
        }

        /* v2.4.0: con SHA-256 esperado del catálogo (sección 1) */
        @JavascriptInterface
        public String dlStart2(String str, String str2, String str3, String str4) {
            try {
                return KiuDownload.start(MainActivity.this, str, str2, str3, str4);
            } catch (Throwable th) {
                return "{\"st\":\"error\",\"err\":\"no se pudo iniciar\"}";
            }
        }

        @JavascriptInterface
        public String dlStatus(String str) {
            try {
                return KiuDownload.status(str);
            } catch (Throwable th) {
                return "{\"st\":\"error\"}";
            }
        }

        @JavascriptInterface
        public String encSec(String str) {
            try {
                return KiuCrypto.enc(str);
            } catch (Throwable th) {
                return "";
            }
        }

        @JavascriptInterface
        public void gc() {
            Runtime.getRuntime().gc();
        }

        @JavascriptInterface
        public String impStatus() {
            try {
                return KiuImport.status();
            } catch (Throwable th) {
                return "{\"st\":\"err\"}";
            }
        }

        @JavascriptInterface
        public void importCancel() {
            try {
                KiuImport.cancel();
            } catch (Throwable unused) {
            }
        }

        @JavascriptInterface
        public void importModel() {
            try {
                KiuImport.pick(MainActivity.this);
            } catch (Throwable unused) {
            }
        }

        /* v2.4.0 (sección 1): copia de seguridad completa vía SAF.
           kiuDataExport(json): abre "Crear documento" (.json) y escribe el JSON.
           kiuDataImport(): abre "Abrir documento" y entrega el JSON a la UI vía
           window.kiuDataRestore(...) (KiuJsPost). Sin claves API: quedan en el
           Keystore del teléfono y nunca viajan en el archivo. */
        @JavascriptInterface
        public boolean kiuDataExport(String json) {
            try {
                if (json == null || json.length() < 2 || json.length() > 30 * 1048576) return false;
                MainActivity.this.pendingExport = json;
                Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("application/json");
                String stamp = new java.text.SimpleDateFormat("yyyyMMdd-HHmm", java.util.Locale.US).format(new java.util.Date());
                i.putExtra(Intent.EXTRA_TITLE, "kiu-copia-" + stamp + ".json");
                MainActivity.this.startActivityForResult(i, 7102);
                return true;
            } catch (Throwable t) {
                MainActivity.this.pendingExport = null;
                return false;
            }
        }

        @JavascriptInterface
        public boolean kiuDataImport() {
            try {
                Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("application/json");
                MainActivity.this.startActivityForResult(i, 7103);
                return true;
            } catch (Throwable t) {
                return false;
            }
        }

        /* ============ v2.5.0 · sección 4 (funciones nuevas) ============ */

        /* 4-b: resumen matutino — agenda/cancela la alarma diaria */
        @JavascriptInterface
        public boolean kiuMorningSet(final int hour, final int minute, final boolean on) {
            try {
                if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return false;
                MainActivity.this.runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        MorningReceiver.set(MainActivity.this, hour, minute, on);
                    }
                });
                return true;
            } catch (Throwable t) {
                return false;
            }
        }

        @JavascriptInterface
        public String kiuMorningGet() {
            try {
                return MorningReceiver.get(MainActivity.this);
            } catch (Throwable t) {
                return "{\"on\":false,\"hour\":8,\"minute\":0}";
            }
        }

        /* 4-a: skills — abre "Abrir documento" y entrega el JSON a window.kiuSkillInstall */
        @JavascriptInterface
        public boolean kiuSkillImport() {
            try {
                Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                MainActivity.this.startActivityForResult(i, 7104);
                return true;
            } catch (Throwable t) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean kiuAvailable() {
            try {
                return KiuNative.available();
            } catch (Throwable th) {
                return false;
            }
        }

        @JavascriptInterface
        public void kiuFree() {
            try {
                if (KiuGenJob.busy) {
                    return;
                }
                KiuGenJob.busy = true;
                KiuGenJob.jt = 3;
                new Thread(new KiuGenJob()).start();
            } catch (Throwable th) {
            }
        }

        @JavascriptInterface
        public boolean kiuGen(String str, int i, float f) {
            try {
                if (KiuGenJob.busy) {
                    return false;
                }
                KiuGenJob.busy = true;
                KiuGenJob.jt = 2;
                KiuGenJob.a1 = str;
                KiuGenJob.a2 = i;
                KiuGenJob.a3 = f;
                new Thread(new KiuGenJob()).start();
                return true;
            } catch (Throwable th) {
                KiuGenJob.busy = false;
                return false;
            }
        }

        @JavascriptInterface
        public String kiuGenStatus() {
            try {
                return KiuNative.genStatus();
            } catch (Throwable th) {
                return "{\"text\":\"\",\"done\":true,\"toks\":0,\"tps\":0}";
            }
        }

        @JavascriptInterface
        public void kiuGenStop() {
            KiuNative.stopGen();
            KiuGenJob.busy = false;
        }

        @JavascriptInterface
        public boolean kiuIsLoaded() {
            try {
                return KiuNative.isLoaded();
            } catch (Throwable th) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean kiuLoad(String str, int i, int i2) {
            try {
                if (KiuGenJob.busy) {
                    return false;
                }
                KiuGenJob.busy = true;
                KiuGenJob.jt = 1;
                KiuGenJob.a1 = str;
                KiuGenJob.a2 = i;
                KiuGenJob.a4 = i2;
                new Thread(new KiuGenJob()).start();
                return true;
            } catch (Throwable th) {
                KiuGenJob.busy = false;
                return false;
            }
        }

        @JavascriptInterface
        public String kiuLoadProgress() {
            try {
                return KiuNative.loadProgress();
            } catch (Throwable th) {
                return "{\"pct\":0,\"loading\":false,\"ready\":false,\"threads\":0}";
            }
        }

        @JavascriptInterface
        public void kiuResetBusy() {
            KiuGenJob.busy = false;
            KiuNative.stopGen();
        }

        @JavascriptInterface
        public String sysInfo() {
            try {
                StringBuilder sb = new StringBuilder();
                MainActivity mainActivity = MainActivity.this;
                ActivityManager activityManager = (ActivityManager) mainActivity.getSystemService("activity");
                ActivityManager.MemoryInfo memoryInfo = new ActivityManager.MemoryInfo();
                activityManager.getMemoryInfo(memoryInfo);
                sb.append("{\"ramTotal\":");
                sb.append(memoryInfo.totalMem);
                sb.append(",\"ramAvail\":");
                sb.append(memoryInfo.availMem);
                StatFs statFs = new StatFs(Environment.getDataDirectory().getPath());
                sb.append(",\"diskTotal\":");
                sb.append(statFs.getTotalBytes());
                sb.append(",\"diskFree\":");
                sb.append(statFs.getAvailableBytes());
                int availableProcessors = Runtime.getRuntime().availableProcessors();
                sb.append(",\"cores\":");
                sb.append(availableProcessors);
                sb.append(",\"model\":\"");
                String str = Build.MODEL;
                if (str != null) {
                    sb.append(str.replace("\\", "").replace("\"", ""));
                }
                sb.append("\"");
                sb.append(",\"os\":\"Android ");
                sb.append(Build.VERSION.RELEASE);
                sb.append("\"");
                Intent registerReceiver = mainActivity.registerReceiver(null, new IntentFilter("android.intent.action.BATTERY_CHANGED"));
                if (registerReceiver != null) {
                    int intExtra = registerReceiver.getIntExtra("level", -1);
                    int intExtra2 = registerReceiver.getIntExtra("scale", -1);
                    int intExtra3 = registerReceiver.getIntExtra("status", -1);
                    int intExtra4 = registerReceiver.getIntExtra("temperature", 0);
                    sb.append(",\"bat\":");
                    if (intExtra2 > 0 && intExtra >= 0) {
                        sb.append((intExtra * 100) / intExtra2);
                    }
                    sb.append(",\"charging\":");
                    if (intExtra3 == 2 || intExtra3 == 5) {
                        sb.append("true");
                    } else {
                        sb.append("false");
                    }
                    sb.append(",\"temp\":");
                    sb.append(intExtra4 / 10.0f);
                }
                sb.append("}");
                return sb.toString();
            } catch (Throwable th) {
                return "{}";
            }
        }

        @JavascriptInterface
        public String version() {
            return "1.4.0";
        }

        private Bridge() {
        }

        @JavascriptInterface
        public void speak(String str) {
            if (!MainActivity.this.ttsReady || TextUtils.isEmpty(str)) {
                return;
            }
            MainActivity.this.runOnUiThread(new Runnable() { // from class: com.kiu.agent.MainActivity.Bridge.1
                @Override // java.lang.Runnable
                public void run() {
                    MainActivity.this.tHandler.removeCallbacks(MainActivity.this.convOpen);
                    MainActivity.this.stopSpeech();
                }
            });
            MainActivity.this.tts.setSpeechRate(MainActivity.this.ttsRate);
            MainActivity.this.tts.setPitch(MainActivity.this.ttsPitch);
            Bundle bundle = new Bundle();
            bundle.putString("networkTts", "true");
            MainActivity.this.tts.speak(str, 0, bundle, "kiu_utt");
        }

        @JavascriptInterface
        public void stopSpeak() {
            MainActivity.SPEAKING = false;
            if (MainActivity.this.tts != null) {
                MainActivity.this.tts.stop();
            }
        }

        @JavascriptInterface
        public void setRate(float f) {
            MainActivity.this.ttsRate = f;
            if (MainActivity.this.ttsReady) {
                MainActivity.this.tts.setSpeechRate(f);
            }
        }

        @JavascriptInterface
        public void setPitch(float f) {
            MainActivity.this.ttsPitch = f;
            if (MainActivity.this.ttsReady) {
                MainActivity.this.tts.setPitch(f);
            }
        }

        @JavascriptInterface
        public void setVoiceName(String str) {
            if (str == null || str.trim().isEmpty()) {
                MainActivity.this.pickBestVoice();
                return;
            }
            try {
                Set<Voice> voices = MainActivity.this.tts.getVoices();
                if (voices == null) {
                    return;
                }
                for (Voice voice : voices) {
                    if (str.equals(voice.getName())) {
                        MainActivity.this.tts.setVoice(voice);
                        return;
                    }
                }
            } catch (Exception unused) {
            }
        }

        @JavascriptInterface
        public String listVoices() {
            Set<Voice> voices;
            JSONArray jSONArray = new JSONArray();
            if (!MainActivity.this.ttsReady || (voices = MainActivity.this.tts.getVoices()) == null) {
                return "[]";
            }
            ArrayList arrayList = new ArrayList();
            for (Voice voice : voices) {
                if (voice.getLocale() != null && voice.getLocale().getLanguage().startsWith("es")) {
                    arrayList.add(voice);
                }
            }
            Collections.sort(arrayList, new Comparator<Voice>() { // from class: com.kiu.agent.MainActivity.Bridge.2
                @Override // java.util.Comparator
                public int compare(Voice voice2, Voice voice3) {
                    return Bridge.this.scoreVoice(voice3) - Bridge.this.scoreVoice(voice2);
                }
            });
            int min = Math.min(arrayList.size(), 40);
            for (int i = 0; i < min; i++) {
                try {
                    Voice voice2 = (Voice) arrayList.get(i);
                    JSONObject jSONObject = new JSONObject();
                    jSONObject.put("name", voice2.getName());
                    jSONObject.put("locale", voice2.getLocale().toLanguageTag());
                    jSONObject.put("q", voice2.getQuality());
                    jSONObject.put("net", voice2.isNetworkConnectionRequired());
                    jSONArray.put(jSONObject);
                } catch (Exception unused) {
                }
            }
            return jSONArray.toString();
        }

        int scoreVoice(Voice voice) {
            String lowerCase = voice.getName().toLowerCase(Locale.US);
            int i = lowerCase.contains("network") ? 10 : 0;
            if (lowerCase.contains("neural") || lowerCase.contains("journey") || lowerCase.contains("studio")) {
                i += 6;
            }
            if (lowerCase.contains("google")) {
                i += 5;
            }
            return voice.getQuality() >= 400 ? i + 4 : i;
        }

        @JavascriptInterface
        public void setHandsFree(boolean z) {
            MainActivity.this.handsFree = z;
            if (z) {
                return;
            }
            MainActivity.this.runOnUiThread(new Runnable() { // from class: com.kiu.agent.MainActivity.Bridge.3
                @Override // java.lang.Runnable
                public void run() {
                    MainActivity.this.tHandler.removeCallbacks(MainActivity.this.convOpen);
                    MainActivity.this.convArmed = false;
                }
            });
        }

        @JavascriptInterface
        public void cancelListen() {
            MainActivity.this.runOnUiThread(new Runnable() { // from class: com.kiu.agent.MainActivity.Bridge.4
                @Override // java.lang.Runnable
                public void run() {
                    MainActivity.this.convArmed = false;
                    MainActivity.this.tHandler.removeCallbacks(MainActivity.this.convOpen);
                    MainActivity.this.stopSpeech();
                    KiuService.resumeSoon();
                    MainActivity.this.js("nexoListenEnd()");
                }
            });
        }

        @JavascriptInterface
        public void pageReady() {
            MainActivity.this.pageReady = true;
            if (MainActivity.this.pendingCmd != null) {
                String str = MainActivity.this.pendingCmd;
                MainActivity.this.pendingCmd = null;
                MainActivity.this.js("nexoWakeCmd(" + MainActivity.this.jsStr(str) + ")");
            }
        }

        @JavascriptInterface
        public void listen() {
            KiuService.suspend();
            MainActivity.this.pendingListen = true;
            if (MainActivity.this.checkSelfPermission("android.permission.RECORD_AUDIO") != 0) {
                MainActivity.this.requestPermissions(new String[]{"android.permission.RECORD_AUDIO"}, MainActivity.REQ_MIC);
            } else {
                MainActivity.this.runOnUiThread(new Runnable() { // from class: com.kiu.agent.MainActivity.Bridge.5
                    @Override // java.lang.Runnable
                    public void run() {
                        MainActivity.this.startSpeech();
                    }
                });
            }
        }

        @JavascriptInterface
        public void vibrate(final int i) {
            MainActivity.this.runOnUiThread(new Runnable() { // from class: com.kiu.agent.MainActivity.Bridge.6
                @Override // java.lang.Runnable
                public void run() {
                    try {
                        Vibrator vibrator = (Vibrator) MainActivity.this.getSystemService("vibrator");
                        if (vibrator == null) {
                            return;
                        }
                        if (Build.VERSION.SDK_INT >= 26) {
                            vibrator.vibrate(VibrationEffect.createOneShot(Math.max(20, i), -1));
                        } else {
                            vibrator.vibrate(Math.max(20, i));
                        }
                    } catch (Exception unused) {
                    }
                }
            });
        }

        @JavascriptInterface
        public void keepOn(final boolean z) {
            MainActivity.this.runOnUiThread(new Runnable() { // from class: com.kiu.agent.MainActivity.Bridge.7
                @Override // java.lang.Runnable
                public void run() {
                    if (z) {
                        MainActivity.this.getWindow().addFlags(128);
                    } else {
                        MainActivity.this.getWindow().clearFlags(128);
                    }
                }
            });
        }

        @JavascriptInterface
        public void bright(final boolean z) {
            MainActivity.this.runOnUiThread(new Runnable() { // from class: com.kiu.agent.MainActivity.Bridge.8
                @Override // java.lang.Runnable
                public void run() {
                    WindowManager.LayoutParams attributes = MainActivity.this.getWindow().getAttributes();
                    attributes.screenBrightness = z ? 1.0f : -1.0f;
                    MainActivity.this.getWindow().setAttributes(attributes);
                }
            });
        }

        @JavascriptInterface
        public void toast(final String str) {
            MainActivity.this.runOnUiThread(new Runnable() { // from class: com.kiu.agent.MainActivity.Bridge.9
                @Override // java.lang.Runnable
                public void run() {
                    Toast.makeText(MainActivity.this, str, 0).show();
                }
            });
        }

        @JavascriptInterface
        public boolean share(String str) {
            try {
                Intent intent = new Intent("android.intent.action.SEND");
                intent.setType("text/plain");
                intent.putExtra("android.intent.extra.TEXT", str);
                MainActivity.this.startActivity(Intent.createChooser(intent, "Compartir con"));
                return true;
            } catch (Exception unused) {
                return false;
            }
        }

        @JavascriptInterface
        public void openUrl(String str) {
            try {
                MainActivity.this.startActivity(new Intent("android.intent.action.VIEW", Uri.parse(str)));
            } catch (Exception unused) {
            }
        }

        @JavascriptInterface
        public boolean torch(boolean z) {
            try {
                CameraManager cameraManager = (CameraManager) MainActivity.this.getSystemService("camera");
                for (String str : cameraManager.getCameraIdList()) {
                    Boolean bool = (Boolean) cameraManager.getCameraCharacteristics(str).get(CameraCharacteristics.FLASH_INFO_AVAILABLE);
                    if (bool != null && bool.booleanValue()) {
                        cameraManager.setTorchMode(str, z);
                        return true;
                    }
                }
            } catch (Exception unused) {
            }
            return false;
        }

        @JavascriptInterface
        public boolean dial(String str) {
            String str2 = "";
            if (str != null) {
                try {
                    str2 = str.replaceAll("[^0-9+*#]", "");
                } catch (Exception unused) {
                    return false;
                }
            }
            if (str2.isEmpty()) {
                return false;
            }
            MainActivity.this.startActivity(new Intent("android.intent.action.DIAL", Uri.parse("tel:" + str2)));
            return true;
        }

        @JavascriptInterface
        public boolean sms(String str, String str2) {
            try {
                Intent intent = new Intent("android.intent.action.SENDTO", Uri.parse("smsto:" + str));
                if (str2 != null && !str2.isEmpty()) {
                    intent.putExtra("sms_body", str2);
                }
                MainActivity.this.startActivity(intent);
                return true;
            } catch (Exception unused) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean waChat(String str, String str2) {
            try {
                StringBuilder sb = new StringBuilder("https://wa.me/");
                sb.append(str != null ? str.replaceAll("\\D", "") : "");
                String sb2 = sb.toString();
                if (str2 != null && !str2.trim().isEmpty()) {
                    sb2 = sb2 + "?text=" + Uri.encode(str2);
                }
                MainActivity.this.startActivity(new Intent("android.intent.action.VIEW", Uri.parse(sb2)));
                return true;
            } catch (Exception unused) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean email(String str, String str2, String str3) {
            try {
                StringBuilder sb = new StringBuilder("mailto:");
                if (str == null) {
                    str = "";
                }
                sb.append(str);
                Intent intent = new Intent("android.intent.action.SENDTO", Uri.parse(sb.toString()));
                if (str2 != null && !str2.isEmpty()) {
                    intent.putExtra("android.intent.extra.SUBJECT", str2);
                }
                if (str3 != null && !str3.isEmpty()) {
                    intent.putExtra("android.intent.extra.TEXT", str3);
                }
                MainActivity.this.startActivity(intent);
                return true;
            } catch (Exception unused) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean maps(String str) {
            try {
                MainActivity mainActivity = MainActivity.this;
                StringBuilder sb = new StringBuilder("geo:0,0?q=");
                if (str == null) {
                    str = "";
                }
                sb.append(Uri.encode(str));
                mainActivity.startActivity(new Intent("android.intent.action.VIEW", Uri.parse(sb.toString())));
                return true;
            } catch (Exception unused) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean ytSearch(String str) {
            try {
                try {
                    Intent intent = new Intent("android.intent.action.SEARCH");
                    intent.setPackage("com.google.android.youtube");
                    intent.putExtra("query", str);
                    MainActivity.this.startActivity(intent);
                    return true;
                } catch (Exception unused) {
                    return false;
                }
            } catch (Exception unused2) {
                MainActivity.this.startActivity(new Intent("android.intent.action.VIEW", Uri.parse("https://www.youtube.com/results?search_query=" + Uri.encode(str))));
                return true;
            }
        }

        @JavascriptInterface
        public boolean webSearch(String str) {
            try {
                try {
                    Intent intent = new Intent("android.intent.action.WEB_SEARCH");
                    intent.putExtra("query", str);
                    MainActivity.this.startActivity(intent);
                    return true;
                } catch (Exception unused) {
                    return false;
                }
            } catch (Exception unused2) {
                MainActivity.this.startActivity(new Intent("android.intent.action.VIEW", Uri.parse("https://www.google.com/search?q=" + Uri.encode(str))));
                return true;
            }
        }

        @JavascriptInterface
        public boolean camera() {
            try {
                MainActivity.this.startActivity(new Intent("android.media.action.IMAGE_CAPTURE"));
                return true;
            } catch (Exception unused) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean setAlarmDevice(int i, int i2) {
            try {
                Intent intent = new Intent("android.intent.action.SET_ALARM");
                intent.putExtra("android.intent.extra.alarm.HOUR", i);
                intent.putExtra("android.intent.extra.alarm.MINUTES", i2);
                MainActivity.this.startActivity(intent);
                return true;
            } catch (Exception unused) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean setTimerDevice(int i, String str) {
            try {
                Intent intent = new Intent("android.intent.action.SET_TIMER");
                intent.putExtra("android.intent.extra.alarm.LENGTH", i);
                if (str != null && !str.isEmpty()) {
                    intent.putExtra("android.intent.extra.alarm.MESSAGE", str);
                }
                MainActivity.this.startActivity(intent);
                return true;
            } catch (Exception unused) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean openApp(String str) {
            Intent launchIntentForPackage;
            try {
                String str2 = (String) MainActivity.APP_MAP.get(MainActivity.javaNorm(str));
                if (str2 != null && (launchIntentForPackage = MainActivity.this.getPackageManager().getLaunchIntentForPackage(str2)) != null) {
                    MainActivity.this.startActivity(launchIntentForPackage);
                    return true;
                }
                MainActivity.this.startActivity(new Intent("android.intent.action.VIEW", Uri.parse("market://search?q=" + Uri.encode(str))));
                return true;
            } catch (Exception unused) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean openSettings(String str) {
            try {
                String str2 = "android.settings.SETTINGS";
                if ("wifi".equals(str)) {
                    str2 = "android.settings.WIFI_SETTINGS";
                } else if ("bluetooth".equals(str)) {
                    str2 = "android.settings.BLUETOOTH_SETTINGS";
                } else if ("sonido".equals(str)) {
                    str2 = "android.settings.SOUND_SETTINGS";
                } else if ("pantalla".equals(str)) {
                    str2 = "android.settings.DISPLAY_SETTINGS";
                } else if ("bateria".equals(str)) {
                    str2 = "android.settings.BATTERY_SAVER_SETTINGS";
                } else if ("apps".equals(str)) {
                    str2 = "android.settings.MANAGE_APPLICATIONS_SETTINGS";
                }
                MainActivity.this.startActivity(new Intent(str2));
                return true;
            } catch (Exception unused) {
                return false;
            }
        }

        /* Reescrito para el build Gradle (el original no descompiló de forma fiable). */
        @JavascriptInterface
        public String contacts(String query) {
            android.database.Cursor cur = null;
            try {
                if (MainActivity.this.checkSelfPermission("android.permission.READ_CONTACTS") != 0) {
                    return "NEED_PERM";
                }
                String like = "%" + (query == null ? "" : query) + "%";
                cur = MainActivity.this.getContentResolver().query(
                        android.provider.ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                        new String[]{"display_name", "data1"},
                        "display_name LIKE ? OR data1 LIKE ?",
                        new String[]{like, like},
                        "starred DESC, times_contacted DESC, display_name ASC");
                JSONArray arr = new JSONArray();
                Set<String> seen = new HashSet<>();
                while (cur != null && cur.moveToNext() && arr.length() < 12) {
                    String name = cur.getString(0);
                    String num = cur.getString(1);
                    if (num == null) {
                        continue;
                    }
                    num = num.trim();
                    if (num.isEmpty()) {
                        continue;
                    }
                    String key = (name == null ? "" : name) + "|" + num;
                    if (seen.contains(key)) {
                        continue;
                    }
                    seen.add(key);
                    JSONObject o = new JSONObject();
                    o.put("name", name == null ? "" : name);
                    o.put("num", num);
                    arr.put(o);
                }
                return arr.toString();
            } catch (Exception unused) {
                return "[]";
            } finally {
                if (cur != null) {
                    try {
                        cur.close();
                    } catch (Exception unused2) {
                    }
                }
            }
        }

        @JavascriptInterface
        public void requestPerm(final String str) {
            MainActivity.this.runOnUiThread(new Runnable() { // from class: com.kiu.agent.MainActivity.Bridge.10
                @Override // java.lang.Runnable
                public void run() {
                    if ("contacts".equals(str)) {
                        MainActivity.this.requestPermissions(new String[]{"android.permission.READ_CONTACTS"}, MainActivity.REQ_CONTACTS);
                    }
                }
            });
        }

        @JavascriptInterface
        public void startWake() {
            MainActivity.this.pendingWake = true;
            if (MainActivity.this.checkSelfPermission("android.permission.RECORD_AUDIO") == 0) {
                MainActivity.this.startWakeNow();
            } else {
                MainActivity.this.requestPermissions(new String[]{"android.permission.RECORD_AUDIO"}, MainActivity.REQ_MIC);
            }
        }

        @JavascriptInterface
        public void stopWake() {
            MainActivity.this.pendingWake = false;
            try {
                WakeWordEngine.get().stop();
            } catch (Exception unused9) {
            }
            MainActivity.this.runOnUiThread(new Runnable() { // from class: com.kiu.agent.MainActivity.Bridge.11
                @Override // java.lang.Runnable
                public void run() {
                    try {
                        MainActivity.this.stopService(new Intent(MainActivity.this, (Class<?>) KiuService.class));
                    } catch (Exception unused) {
                    }
                    MainActivity.this.getSharedPreferences("kiu_native", 0).edit().putBoolean("wake", false).apply();
                    MainActivity.this.js("nexoWakeState(false)");
                }
            });
        }

        @JavascriptInterface
        public boolean wakeState() {
            return KiuService.ACTIVE;
        }

        /* ---- wake word 100% local (Vosk) ---- */

        @JavascriptInterface
        public String kiuWWState() {
            try {
                return WakeWordEngine.get().statusJson(MainActivity.this);
            } catch (Throwable th) {
                return "{\"st\":\"idle\",\"present\":false}";
            }
        }

        @JavascriptInterface
        public boolean kiuWWStart() {
            try {
                MainActivity.this.getSharedPreferences("kiu_native", 0).edit().putBoolean("wwLocal", true).apply();
                return WakeWordEngine.get().start(MainActivity.this);
            } catch (Throwable th) {
                return false;
            }
        }

        @JavascriptInterface
        public void kiuWWStop() {
            try {
                MainActivity.this.getSharedPreferences("kiu_native", 0).edit().putBoolean("wwLocal", false).apply();
                WakeWordEngine.get().stop();
            } catch (Throwable unused) {
            }
        }

        @JavascriptInterface
        public void startTimerNative(int i, final String str) {
            long max = Math.max(1, i) * 1000;
            final String msg = (str == null || str.trim().isEmpty()) ? "Se terminó el tiempo" : str;
            MainActivity.this.tRun = new Runnable() { // from class: com.kiu.agent.MainActivity.Bridge.12
                @Override // java.lang.Runnable
                public void run() {
                    MainActivity.this.timerFire(msg);
                }
            };
            MainActivity.this.tHandler.postDelayed(MainActivity.this.tRun, max);
        }

        @JavascriptInterface
        public void cancelTimerNative() {
            if (MainActivity.this.tRun != null) {
                MainActivity.this.tHandler.removeCallbacks(MainActivity.this.tRun);
                MainActivity.this.tRun = null;
            }
        }

        @JavascriptInterface
        public void setReminder(final String str, final String str2, final long j) {
            MainActivity.this.runOnUiThread(new Runnable() { // from class: com.kiu.agent.MainActivity.Bridge.13
                @Override // java.lang.Runnable
                public void run() {
                    Alarms.schedule(MainActivity.this, str, str2, j);
                }
            });
        }

        @JavascriptInterface
        public void cancelReminder(final String str) {
            MainActivity.this.runOnUiThread(new Runnable() { // from class: com.kiu.agent.MainActivity.Bridge.14
                @Override // java.lang.Runnable
                public void run() {
                    Alarms.cancel(MainActivity.this, str);
                }
            });
        }

        @JavascriptInterface
        public String pendingReminders() {
            return Alarms.all(MainActivity.this).toString();
        }

        @JavascriptInterface
        public boolean canExactAlarms() {
            return Alarms.canExact(MainActivity.this);
        }

        @JavascriptInterface
        public void openExactAlarmSettings() {
            try {
                if (Build.VERSION.SDK_INT >= 31) {
                    MainActivity.this.startActivity(new Intent("android.settings.REQUEST_SCHEDULE_EXACT_ALARM", Uri.parse("package:" + MainActivity.this.getPackageName())));
                }
            } catch (Exception unused) {
            }
        }

        @JavascriptInterface
        public boolean addCalendarEvent(String str, long j) {
            try {
                Intent intent = new Intent("android.intent.action.INSERT");
                intent.setData(CalendarContract.Events.CONTENT_URI);
                intent.putExtra("beginTime", j);
                intent.putExtra("endTime", j + 3600000);
                intent.putExtra("title", str);
                intent.putExtra("description", "Creado con Kiu");
                MainActivity.this.startActivity(intent);
                return true;
            } catch (Exception unused) {
                return false;
            }
        }

        /* ============ v2.3.0 · sección 2 (seguridad) ============ */

        /* ---- ferry único: localStorage del origen viejo (file://) → origen seguro ---- */
        @JavascriptInterface
        public void kiuFerryPut(final String str) {
            try {
                MainActivity.this.getSharedPreferences("kiu_ferry", 0).edit()
                        .putString("json", str == null ? "" : str)
                        .putBoolean("done", true).apply();
                MainActivity.this.runOnUiThread(new Runnable() {
                    @Override // java.lang.Runnable
                    public void run() {
                        try { MainActivity.this.web.loadUrl(ASSET_BASE + "www/index.html"); } catch (Throwable ignored) { }
                    }
                });
            } catch (Throwable ignored) { }
        }

        @JavascriptInterface
        public String kiuFerryGet() {
            try {
                return MainActivity.this.getSharedPreferences("kiu_ferry", 0).getString("json", "");
            } catch (Throwable th) {
                return "";
            }
        }

        @JavascriptInterface
        public void kiuFerryClear() {
            try {
                MainActivity.this.getSharedPreferences("kiu_ferry", 0).edit().remove("json").apply();
            } catch (Throwable ignored) { }
        }

        /* ---- bóveda de claves API: cifradas con Keystore (KiuCrypto); la clave en
           claro jamás se guarda ni se entrega a la WebView (solo últimos 4) ---- */
        @JavascriptInterface
        public void kiuKeysSet(String str, String str2) {
            try {
                if (str == null || str.trim().isEmpty()) return;
                SharedPreferences sp = MainActivity.this.getSharedPreferences("kiu_keys", 0);
                if (str2 == null || str2.isEmpty()) sp.edit().remove("k_" + str).apply();
                else sp.edit().putString("k_" + str, KiuCrypto.enc(str2)).apply();
            } catch (Throwable ignored) { }
        }

        @JavascriptInterface
        public String kiuKeysGet(String str) {
            try {
                String e = MainActivity.this.getSharedPreferences("kiu_keys", 0).getString("k_" + str, null);
                return e == null ? "" : KiuCrypto.dec(e);
            } catch (Throwable th) {
                return "";
            }
        }

        @JavascriptInterface
        public boolean kiuKeysHas(String str) {
            try {
                return MainActivity.this.getSharedPreferences("kiu_keys", 0).contains("k_" + str);
            } catch (Throwable th) {
                return false;
            }
        }

        @JavascriptInterface
        public void kiuKeysDel(String str) {
            try {
                MainActivity.this.getSharedPreferences("kiu_keys", 0).edit().remove("k_" + str).apply();
            } catch (Throwable ignored) { }
        }

        @JavascriptInterface
        public String kiuKeysList() {
            try {
                Map<String, ?> all = MainActivity.this.getSharedPreferences("kiu_keys", 0).getAll();
                JSONObject o = new JSONObject();
                for (String k : all.keySet()) {
                    if (!k.startsWith("k_")) continue;
                    String name = k.substring(2);
                    String plain = KiuCrypto.dec(String.valueOf(all.get(k)));
                    o.put(name, plain.length() > 4 ? plain.substring(plain.length() - 4) : "****");
                }
                return o.toString();
            } catch (Throwable th) {
                return "{}";
            }
        }

        /* ---- proxy HTTP(S) hecho en Java: la WebView no abre el socket ni ve la clave;
           los placeholders {{key:nombre}} se reemplazan acá adentro ---- */
        @JavascriptInterface
        public boolean kiuApiStart(String str, String str2, String str3, String str4, String str5) {
            return KiuApiProxy.start(MainActivity.this, str, str2, str3, str4, str5);
        }

        @JavascriptInterface
        public String kiuApiPoll(String str) {
            return KiuApiProxy.poll(str);
        }

        @JavascriptInterface
        public void kiuApiStop(String str) {
            KiuApiProxy.stop(str);
        }
    }

    /* JADX INFO: Access modifiers changed from: private */
    public void startSpeech() {
        KiuService.suspend();
        this.convArmed = this.handsFree && this.resumed;
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            this.convArmed = false;
            js("nexoVoiceError('unavailable')");
            js("nexoListenEnd()");
            this.pendingListen = false;
            KiuService.resumeSoon();
            return;
        }
        stopSpeech();
        SpeechRecognizer createSpeechRecognizer = SpeechRecognizer.createSpeechRecognizer(this);
        this.recognizer = createSpeechRecognizer;
        createSpeechRecognizer.setRecognitionListener(new RecognitionListener() { // from class: com.kiu.agent.MainActivity.7
            @Override // android.speech.RecognitionListener
            public void onBeginningOfSpeech() {
            }

            @Override // android.speech.RecognitionListener
            public void onBufferReceived(byte[] bArr) {
            }

            @Override // android.speech.RecognitionListener
            public void onEndOfSpeech() {
            }

            @Override // android.speech.RecognitionListener
            public void onEvent(int i, Bundle bundle) {
            }

            @Override // android.speech.RecognitionListener
            public void onRmsChanged(float f) {
            }

            @Override // android.speech.RecognitionListener
            public void onReadyForSpeech(Bundle bundle) {
                MainActivity.this.js("nexoListenStart()");
            }

            @Override // android.speech.RecognitionListener
            public void onPartialResults(Bundle bundle) {
                ArrayList<String> stringArrayList = bundle.getStringArrayList("results_recognition");
                if (stringArrayList == null || stringArrayList.isEmpty() || TextUtils.isEmpty(stringArrayList.get(stringArrayList.size() - 1))) {
                    return;
                }
                MainActivity.this.js("nexoVoicePartial(" + MainActivity.this.jsStr(stringArrayList.get(stringArrayList.size() - 1)) + ")");
            }

            @Override // android.speech.RecognitionListener
            public void onError(int i) {
                MainActivity.this.stopSpeech();
                if (!MainActivity.this.convArmed || !MainActivity.this.handsFree || !MainActivity.this.resumed || !MainActivity.convWindowOpen(MainActivity.this.lastConvBeat)) {
                    MainActivity.this.convArmed = false;
                    KiuService.resumeSoon();
                    MainActivity.this.js("nexoListenEnd()");
                    if (MainActivity.this.pendingListen) {
                        MainActivity.this.pendingListen = false;
                        MainActivity.this.js("nexoVoiceError('error')");
                        return;
                    }
                    return;
                }
                MainActivity.this.tHandler.removeCallbacks(MainActivity.this.convOpen);
                MainActivity.this.tHandler.postDelayed(MainActivity.this.convOpen, 800L);
                MainActivity.this.js("nexoListenEnd()");
            }

            @Override // android.speech.RecognitionListener
            public void onResults(Bundle bundle) {
                MainActivity.this.stopSpeech();
                MainActivity.this.lastConvBeat = SystemClock.elapsedRealtime();
                ArrayList<String> stringArrayList = bundle.getStringArrayList("results_recognition");
                String str = (stringArrayList == null || stringArrayList.isEmpty()) ? null : stringArrayList.get(0);
                if (str == null || TextUtils.isEmpty(str.trim())) {
                    if (!MainActivity.this.convArmed || !MainActivity.this.handsFree || !MainActivity.this.resumed || !MainActivity.convWindowOpen(MainActivity.this.lastConvBeat)) {
                        MainActivity.this.convArmed = false;
                        KiuService.resumeSoon();
                        MainActivity.this.js("nexoListenEnd()");
                        if (MainActivity.this.pendingListen) {
                            MainActivity.this.pendingListen = false;
                            MainActivity.this.js("nexoVoiceError('no_match')");
                            return;
                        }
                        return;
                    }
                    MainActivity.this.tHandler.removeCallbacks(MainActivity.this.convOpen);
                    MainActivity.this.tHandler.postDelayed(MainActivity.this.convOpen, 800L);
                    MainActivity.this.js("nexoListenEnd()");
                    return;
                }
                MainActivity.this.pendingListen = false;
                MainActivity.this.js("nexoOnVoice(" + MainActivity.this.jsStr(str) + ")");
            }
        });
        Intent intent = new Intent("android.speech.action.RECOGNIZE_SPEECH");
        intent.putExtra("android.speech.extra.LANGUAGE_MODEL", "free_form");
        intent.putExtra("android.speech.extra.LANGUAGE", "es-AR");
        intent.putExtra("android.speech.extra.LANGUAGE_PREFERENCE", "es-AR");
        intent.putExtra("android.speech.extra.PARTIAL_RESULTS", true);
        intent.putExtra("android.speech.extra.MAX_RESULTS", 2);
        intent.putExtra("calling_package", getPackageName());
        intent.putExtra("android.speech.extra.PROMPT", "Hablale a Kiu...");
        try {
            this.recognizer.startListening(intent);
        } catch (Exception unused) {
            this.convArmed = false;
            stopSpeech();
            KiuService.resumeSoon();
            js("nexoListenEnd()");
        }
    }

    /* JADX INFO: Access modifiers changed from: private */
    public void stopSpeech() {
        SpeechRecognizer speechRecognizer = this.recognizer;
        if (speechRecognizer != null) {
            try {
                speechRecognizer.destroy();
            } catch (Exception unused) {
            }
            this.recognizer = null;
        }
    }

    /* JADX INFO: Access modifiers changed from: private */
    public void js(final String str) {
        runOnUiThread(new Runnable() { // from class: com.kiu.agent.MainActivity.8
            @Override // java.lang.Runnable
            public void run() {
                if (MainActivity.this.web != null) {
                    MainActivity.this.web.evaluateJavascript(str, null);
                }
            }
        });
    }

    /* JADX INFO: Access modifiers changed from: private */
    public String jsStr(String str) {
        /* v2.7.1: JSONObject.quote escapa comillas, barras y saltos. El escape manual anterior
           dejaba \\" (cierra el string) y permitia inyectar JS desde el extra "cmd" del Intent
           (MainActivity esta exported) o desde una transcripcion de voz con comillas. */
        String q = jsonQuote(str == null ? "" : str);
        return q.replace("\u2028", "\\u2028").replace("\u2029", "\\u2029");
    }

    @Override // android.app.Activity
    public void onRequestPermissionsResult(int i, String[] strArr, int[] iArr) {
        if (i != REQ_MIC) {
            if (i == REQ_CONTACTS) {
                boolean z = iArr.length > 0 && iArr[0] == 0;
                StringBuilder sb = new StringBuilder("nexoPerm('contacts',");
                sb.append(z ? "true" : "false");
                sb.append(")");
                js(sb.toString());
                return;
            }
            if (i == REQ_NOTIF) {
                if ((iArr.length > 0 && iArr[0] == 0) && this.pendingWake) {
                    this.pendingWake = false;
                    startWakeNow();
                    return;
                }
                return;
            }
            return;
        }
        if (iArr.length > 0 && iArr[0] == 0) {
            if (this.pendingListen) {
                this.pendingListen = false;
                runOnUiThread(new Runnable() { // from class: com.kiu.agent.MainActivity.9
                    @Override // java.lang.Runnable
                    public void run() {
                        MainActivity.this.startSpeech();
                    }
                });
                return;
            } else {
                if (this.pendingWake) {
                    this.pendingWake = false;
                    startWakeNow();
                    return;
                }
                return;
            }
        }
        if (this.pendingListen) {
            js("nexoVoiceError('no_permission')");
        }
        this.pendingListen = false;
        this.pendingWake = false;
        Toast.makeText(this, "Dale permiso de micrófono para hablar con Kiu", 1).show();
    }

    @Override // android.app.Activity
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleExtras(intent);
    }

    @Override // android.app.Activity
    public void onBackPressed() {
        moveTaskToBack(true);
    }

    @Override // android.app.Activity
    protected void onPause() {
        super.onPause();
        this.resumed = false;
        this.convArmed = false;
        this.tHandler.removeCallbacks(this.convOpen);
        stopSpeech();
        SPEAKING = false;
        TextToSpeech textToSpeech = this.tts;
        if (textToSpeech == null || !textToSpeech.isSpeaking()) {
            return;
        }
        this.tts.stop();
    }

    @Override // android.app.Activity
    protected void onResume() {
        super.onResume();
        this.resumed = true;
    }

    @Override // android.app.Activity
    protected void onDestroy() {
        inst = null;
        try {
            WakeWordEngine.get().stop();
        } catch (Exception unused) {
        }
        stopSpeech();
        TextToSpeech textToSpeech = this.tts;
        if (textToSpeech != null) {
            try {
                textToSpeech.stop();
                this.tts.shutdown();
            } catch (Exception unused) {
            }
        }
        WebView webView = this.web;
        if (webView != null) {
            webView.destroy();
        }
        // v2.6.1 (auditoría de memoria): al cerrar de verdad la actividad (atrás,
        // finish, deslizar de recientes) liberamos el modelo nativo para no dejar
        // cientos de MB de RAM reservados en un proceso que Android mantiene en
        // caché. En rotación isFinishing() es false: el modelo sigue cargado y no
        // hay que re-cargarlo. Idempotente y sin bloquear el hilo UI (freeAsync).
        if (isFinishing()) {
            KiuGenJob.freeAsync();
        }
        super.onDestroy();
    }
}
