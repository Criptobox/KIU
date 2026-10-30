# Revisión de pantallas — KIU 2.20.2

Qué se mira, con qué límites, y qué conviene mejorar. **Es una revisión: no se cambió ninguna pantalla.**

## Cómo se revisó (y qué no se pudo ver)

- `index.html` abierto en Chromium de escritorio con viewport de teléfono (390 × 844, 2×), una captura por pantalla y otra con todo el scroll.
- **Sin el puente de Android:** no hay RAM, batería, modelos ni permisos reales. Las cifras vacías («—», «0 en disco», «sin modelo cargado») son del entorno, no defectos.
- **Sin teléfono real:** tipografías, notch, teclado y gestos pueden verse distinto. Lo de abajo es lo que se ve en la estructura, no una prueba de uso.
- La burbuja «Buenas noches. Soy Kiu…» que sale sobre todas las pantallas es un aviso temporal del saludo (`app-ui.js`, `greet()`); apareció porque se capturó a los pocos segundos de abrir.

Pantallas: Inicio, Chat, Biblioteca, Modelos, Memoria, Ajustes (+ ventanas modales de bienvenida y del Asistente de voz). Barra inferior: Inicio · Chat · Modelos · Memoria · Ajustes.

## Problemas que se repiten en toda la app

1. **Lo importante no se distingue de lo técnico.** El estado «sin modelo» (sin el cual la app casi no hace nada) se ve como un dato más, no como la acción principal. Los botones de diagnóstico están al mismo nivel que los de uso diario.
2. **Cosas repetidas.** El mismo saludo sale 3 veces (texto del héroe, aviso flotante y voz); «Memoria» se repite 3 veces en su pantalla; los contadores y las pestañas de Memoria son lo mismo; Chat y Memoria están en la tarjetas de Inicio **y** en la barra inferior.
3. **Navegación.** «Biblioteca» no tiene lugar en la barra (se llega desde Inicio como «Herramientas»). *(Corrección: en la primera versión de este informe dije que el «volver» de Modelos siempre llevaba a Ajustes. Es solo el valor por defecto del HTML: `go()` en `app-ui.js` lo reasigna a la pantalla desde la que se entró, así que no es un problema.)*
4. **Iconos sin texto.** El encabezado del Chat tiene 4 botones (lista, cuadrícula, onda, altavoz) sin etiqueta.
5. **Texto largo donde debería haber una acción.** Párrafos explicativos en Modelos, el mensaje de bienvenida del Chat y las descripciones de Ajustes.

## Por pantalla

### Inicio
- Héroe grande + avatar chico en el encabezado: dos avatares a la vez.
- La tarjeta «Sin motor conectado» tiene un texto naranja monoespaciado («sin modelo cargado»), una barra de RAM vacía y el rótulo «Desconectado · Tu teléfono». Debería ser un botón claro: **«Elegir un modelo»**.
- 4 tarjetas rápidas (Chat, Voz, Herramientas, Memoria): dos duplican la barra inferior.
- «Estado del sistema» y «Actividad reciente» ocupan más de media pantalla de scroll para información secundaria.
- Mejoras: una sola acción principal (hablar / escribir), el estado del modelo como CTA cuando falta, y el estado del sistema colapsado.

### Chat
- El mensaje de bienvenida es un muro de 3 párrafos, más alto que una pantalla de teléfono.
- Barra de acciones (reintentar, copiar, me gusta, compartir) bajo la bienvenida: no tienen sentido ahí.
- Una píldora «Listo» suelta en medio de la conversación.
- El aviso del saludo cae sobre la caja de texto y tapa «Escribe…».
- Encabezado con 4 iconos sin etiqueta.
- Mejoras: bienvenida de 1 línea + 3–4 sugerencias tocables (ya existen como chips horizontales), acciones por mensaje solo en las respuestas reales, iconos con etiqueta o agrupados en un menú.

### Biblioteca
- 15 herramientas en cuadrícula de 3 (bien) + 9 «Conexiones» en lista larga, todas con el botón «Conectar».
- «Conectar» confunde: son atajos a apps del teléfono (WhatsApp, Mapas…), no cuentas que se enlazan.
- Hay una pestaña «Cuentas» y no está claro qué contiene.
- Mejoras: «Conexiones» como cuadrícula compacta o chips, y renombrar el botón («Abrir», «Usar»).

### Modelos (la más urgente)
- **3133 px de alto frente a 756 visibles: unas 4 pantallas de scroll.**
- Mezcla 4 trabajos distintos: política de enrutamiento (Híbrido/Local/API + Orquestador + asignación por tipo de tarea + modelos preferidos), tarjeta del teléfono, «Mis modelos» y catálogo de descarga.
- Lo que casi todos necesitan (**descargar o elegir un modelo**) queda al final.
- «Probar agente», «Prueba completa» y «Sin gramática» están como botones normales entre «Mis modelos» y el catálogo: son herramientas de diagnóstico.
- Texto largo explicando el orquestador, dos veces.
- Mejoras: arrancar por «tu modelo» (cargado, o botón para elegir) + catálogo con el recomendado marcado; mover el enrutamiento avanzado a «Avanzado» plegado; mover las pruebas a una sección «Diagnóstico».

### Memoria
- Cinco contadores en 3 + 2 (queda un hueco) **y** una fila de pestañas con los mismos cinco nombres (la última, «Gustos», se corta).
- Tarjeta «Memoria — Todo lo que Kiu sabe de vos» repite el título.
- El bloque «Documentos (RAG)» con etiqueta «APAGADO» queda entre los contadores y las pestañas, partiendo la página; «APAGADO» no dice qué se apagó.
- Estado vacío: mucho espacio en blanco y una sola frase.
- Mejoras: una sola fila de pestañas con el número dentro de cada una; Documentos al final o en su propia sección; estado vacío con un ejemplo y un botón.

### Ajustes
- 7 filas con icono, «Voz» se despliega y las demás navegan: comportamientos distintos para filas idénticas.
- Controles sueltos (Creatividad, Largo de respuestas) entre las filas y los botones de Diagnóstico.
- «Diagnóstico» y «Actualizaciones» son 5 botones anchos de igual peso.
- Pie con texto técnico pequeño («Wake word offline · WebView seguro (AssetLoader)…»).
- «Kiu v?» en la tarjeta de perfil (en un teléfono sale la versión; aquí no hay puente).
- Mejoras: agrupar (Uso · Aspecto · Datos · Avanzado), filas con el mismo comportamiento, diagnóstico/actualizaciones juntos y plegados.

### Ventanas modales
- **Bienvenida:** pide nombre y se abre sobre una pantalla que aún no dice qué hacer. Bien de intención; el aviso del saludo se solapa.
- **Asistente de voz:** se abrió solo en Memoria en este entorno (no hay permisos). En un teléfono sin esos permisos podría pasar igual: conviene que solo abra cuando el usuario lo pida o tras la bienvenida, y no sobre otra pantalla.
- Los textos de las filas se cortan con «…» («Servicio de voz del te…», «Despertar por voz sin int…»).

## Propuesta ordenada (de más a menos valor por esfuerzo)

| # | Cambio | Pantalla | Esfuerzo | Riesgo |
|---|---|---|---|---|
| 1 | Modelos: «tu modelo» arriba, catálogo con recomendado, avanzado y diagnóstico plegados | Modelos | medio | bajo (se mueve, no se borra) |
| 2 | Inicio: tarjeta de estado como CTA «Elegir un modelo» cuando falta | Inicio | bajo | bajo |
| 3 | Chat: bienvenida corta + sugerencias; acciones solo en respuestas; iconos con etiqueta | Chat | bajo–medio | bajo |
| 4 | Memoria: fusionar contadores y pestañas; mover Documentos | Memoria | bajo | bajo |
| 5 | Saludo: una sola vez (voz o aviso, no ambos); aviso fuera de la caja de texto | global | bajo | bajo |
| 6 | Ajustes: agrupar y plegar diagnóstico/actualizaciones | Ajustes | medio | bajo |
| 7 | Biblioteca: «Conexiones» compactas y renombrar «Conectar» | Biblioteca | bajo | bajo |
| 8 | Un único sistema visual (espaciado, jerarquía de títulos, botones primario/secundario) | global | alto | medio |

Recomendación: hacer **1, 2 y 5** primero. Son lo que más pesa en el primer uso (sin modelo la app no hace nada) y no obligan a rediseñar nada profundo.

## Estado

- **Hecho en 2.20.3:** #1 (Modelos), #2 (Inicio) y #5 (saludo una sola vez). Ver el CHANGELOG.
- **Pendiente:** #3 Chat, #4 Memoria, #6 Ajustes, #7 Biblioteca, #8 sistema visual. También queda el Asistente de voz que se abre solo.

## Verificación pendiente

Todo lo de arriba se vio en un navegador de escritorio. Antes de dar un cambio por bueno hay que mirarlo en el teléfono, con un modelo cargado y con permisos reales. Los tests existentes (`tests/*.test.mjs`) cubren lógica y estructura del HTML, no la apariencia: un rediseño necesita capturas de antes/después.
