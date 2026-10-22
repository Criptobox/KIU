# Pruebas del parche

Desde la raíz del paquete extraído:

```sh
node --check assets/www/js/app/motor.js
node --test ../tests/motor-reset-regression.test.cjs
```

Las pruebas son regresiones de código y no sustituyen una ejecución con Android/JNI real.
