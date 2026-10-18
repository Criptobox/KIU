package com.kiu.agent;

import android.security.keystore.KeyGenParameterSpec;
import android.util.Base64;
import java.security.KeyStore;
import java.util.Arrays;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/* loaded from: classes.dex */
public class KiuCrypto {
    public static String dec(String str) {
        try {
            SecretKey key = key();
            byte[] decode = Base64.decode(str, 2);
            byte[] copyOf = Arrays.copyOf(decode, 12);
            byte[] copyOfRange = Arrays.copyOfRange(decode, 12, decode.length);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(12, key, new GCMParameterSpec(128, copyOf));
            return new String(cipher.doFinal(copyOfRange), "UTF-8");
        } catch (Throwable th) {
            return "";
        }
    }

    public static String enc(String str) {
        try {
            SecretKey key = key();
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(1, key);
            byte[] iv = cipher.getIV();
            byte[] doFinal = cipher.doFinal(str.getBytes("UTF-8"));
            byte[] bArr = new byte[iv.length + doFinal.length];
            System.arraycopy(iv, 0, bArr, 0, iv.length);
            System.arraycopy(doFinal, 0, bArr, iv.length, doFinal.length);
            return Base64.encodeToString(bArr, 0);
        } catch (Throwable th) {
            return "";
        }
    }

    private static SecretKey key() throws java.security.KeyStoreException, java.security.cert.CertificateException, java.io.IOException, java.security.NoSuchAlgorithmException, javax.crypto.NoSuchPaddingException, java.security.InvalidAlgorithmParameterException, java.security.UnrecoverableKeyException, java.security.NoSuchProviderException {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        if (keyStore.containsAlias("kiu_main")) {
            return (SecretKey) keyStore.getKey("kiu_main", null);
        }
        KeyGenerator keyGenerator = KeyGenerator.getInstance("AES", "AndroidKeyStore");
        keyGenerator.init(new KeyGenParameterSpec.Builder("kiu_main", 3).setBlockModes("GCM").setEncryptionPaddings("NoPadding").setKeySize(256).build());
        return keyGenerator.generateKey();
    }
}
