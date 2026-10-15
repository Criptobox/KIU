import java.io.File

// Módulo app de KIU — Java puro + WebView + motor llama.cpp
//
// Dos modos de build (automático, sin configurar nada):
//  1) MODO PREBUILT (por defecto): usa las .so ya compiladas en
//     app/src/main/jniLibs/<ABI> (libkiullama.so + ggml/llama, arm64-v8a).
//     Esos binarios NO viven en Git (.gitignore): se regeneran con el modo
//     fuente o copiándolos de un build previo.
//  2) MODO FUENTE: si existe vendor/llama.cpp, compila el motor y el wrapper
//     JNI (app/src/main/cpp) con NDK + CMake. Ejecutar antes:
//       ./scripts/vendor_llama.sh   (clona llama.cpp en vendor/)
//     Los .so compilados quedan inyectados en app/src/main/jniLibs/<ABI> y el
//     APK los empaqueta directo del pipeline CMake (sin duplicar librerías).
plugins {
    id("com.android.application")
}

val llamaDir = File(rootDir, "vendor/llama.cpp")
val buildNative = llamaDir.exists()

// ABIs con .so precompiladas disponibles (app/src/main/jniLibs/<ABI>/*.so, fuera de Git)
val jniLibsDir = File(projectDir, "src/main/jniLibs")
val prebuiltAbis = (jniLibsDir.listFiles { f -> f.isDirectory } ?: emptyArray())
    .filter { dir -> dir.listFiles { f -> f.name.endsWith(".so") }?.isNotEmpty() == true }
    .map { it.name }
    .sorted()

android {
    namespace = "com.kiu.agent"
    compileSdk = 34
    ndkVersion = "27.0.12077973"

    defaultConfig {
        applicationId = "com.kiu.agent"
        minSdk = 24
        targetSdk = 34
        versionCode = 37
        versionName = "2.8.1"

        if (buildNative) {
            ndk {
                // x86_64 permite probar el motor en emulador
                abiFilters += listOf("arm64-v8a", "x86_64")
            }
        } else if (prebuiltAbis.isNotEmpty()) {
            ndk {
                // modo prebuilt: solo las ABIs que de verdad hay en jniLibs,
                // así el APK no arrastra ABIs inútiles de los AAR (Vosk/JNA)
                abiFilters += prebuiltAbis
            }
        }
    }

    sourceSets {
        getByName("main") {
            // jniLibs estándar: app/src/main/jniLibs/<ABI> (ubicación por defecto,
            // no hace falta declararla). En modo fuente se desactiva como origen
            // para no empaquetar cada .so dos veces: el APK toma las del pipeline
            // CMake, que a la vez las inyecta en esa misma carpeta.
            if (buildNative) {
                jniLibs.setSrcDirs(emptyList<String>())
            }
        }
    }

    // Sin vendor y sin precompiladas no hay motor: fallar temprano con la receta.
    if (!buildNative && prebuiltAbis.isEmpty()) {
        throw GradleException(
            "KIU: no hay librerías nativas del motor (app/src/main/jniLibs).\n" +
            "  Recuperarlas: ./scripts/vendor_llama.sh && ./gradlew :app:assembleDebug\n" +
            "  (compila llama.cpp desde fuente y deja los .so en app/src/main/jniLibs/<ABI>)"
        )
    }

    if (buildNative) {
        externalNativeBuild {
            cmake {
                path = file("src/main/cpp/CMakeLists.txt")
                version = "3.22.1"
            }
        }
    }

    signingConfigs {
        // Firma release por entorno (reemplaza al uber-apk-signer del flujo apktool):
        //   KIU_PASS=clave  +  keystore/kiu-release.jks  (o KIU_KS=/ruta KIU_ALIAS=alias)
        // Sin KIU_PASS, assembleRelease firma con la clave debug (solo para probar).
        val ksPath = System.getenv("KIU_KS") ?: "keystore/kiu-release.jks"
        val ksPass = System.getenv("KIU_PASS")
        if (ksPass != null && File(ksPath).exists()) {
            create("kiu") {
                storeFile = file(ksPath)
                storePassword = ksPass
                keyAlias = System.getenv("KIU_ALIAS") ?: "kiu"
                keyPassword = ksPass
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = if (signingConfigs.findByName("kiu") != null) {
                signingConfigs.getByName("kiu")
            } else {
                signingConfigs.getByName("debug")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    packaging {
        // modelos GGUF y assets grandes: sin compresión agresiva
        jniLibs.useLegacyPackaging = true
    }

    lint {
        abortOnError = false
    }
}

dependencies {
    // Wake word local (offline) — motor Vosk + JNA
    implementation("com.alphacephei:vosk-android:0.3.47")
    implementation("net.java.dev.jna:jna:5.13.0@aar")

    // v2.3.0 (sección 2 · seguridad): WebViewAssetLoader — la UI se sirve por
    // https://appassets.androidplatform.net en vez de file://, sin permisos
    // universales de lectura de archivos.
    implementation("androidx.webkit:webkit:1.11.0")
}
