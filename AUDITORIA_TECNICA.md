# Auditoria tecnica de Milla

## Resumen del proyecto

Milla es un reproductor local para Android construido con Expo 57, React Native 0.86 y React 19. Su catalogo principal vive en SQLite (`milla.db`), el audio se reproduce con Expo Audio mediante `services/player-engine.ts` y el backend Django actua como cache de letras y motor DSP opcional. La aplicacion tambien incluye busqueda/reparacion de metadatos, biblioteca por MediaStore o SAF, descargas, historial, temas y una cola inteligente Auto Mix.

## Flujo de datos

1. `App.tsx` inicializa SQLite y recupera el catalogo persistido.
2. `library-service.ts` obtiene audio global mediante MediaLibrary o recorre una carpeta SAF.
3. Las URI SAF de External Storage se convierten a `file://` y se guardan saneadas en SQLite.
4. `metadata-service.ts` lee etiquetas y caratulas por bloques para FLAC, MP3 y M4A; los formatos restantes usan el lector tolerante anterior.
5. `audio-service.ts` valida cada URI antes de entregarla al motor Expo Audio.
6. `queue-service.tsx` calcula la siguiente pista usando prioridad manual, BPM y rueda Camelot.
7. `playback-service.ts` mantiene una sola pista futura preparada y aplica transiciones de volumen.
8. `LyricsModal.tsx` usa `am-lyrics` para letras interpoladas en linea y conserva la letra LRC local como modo sin conexion.

## APIs y servicios utilizados

| API o modulo | Uso | Riesgo/control |
| --- | --- | --- |
| Expo MediaLibrary | Permiso granular y escaneo global de audio | Solo solicita `audio`; pagina hasta 10.000 recursos. |
| Expo FileSystem/SAF | Selector y recursion de carpetas | Evita confiar en `isDirectory` para documentos SAF y prueba la lectura de subdirectorios. |
| Expo Audio + `player-engine.ts` | Reproduccion, seek, pantalla bloqueada y cola | Compatible con Expo 57; toda URI pasa por saneamiento y validacion antes de cargarse. |
| Expo SQLite | Catalogo, letras, BPM, historial y ajustes | El catalogo se carga al arrancar y no depende de un escaneo nuevo. |
| `@missingcore/audio-metadata` | Etiquetas y caratulas embebidas | Lectura parcial por posicion/longitud para evitar cargar el audio completo. |
| `@uimaxbai/am-lyrics` | Letras LyricsPlus/Apple, TTML y animacion por palabra | Ejecutado dentro de Expo DOM; no se importa como componente nativo. |
| MusicBrainz | Reparacion de titulo, artista y album | Resultado aceptado solo con puntuacion superior a 70; ya no inventa BPM ni tonalidad. |
| LRCLIB | Respaldo de letras en Django | Timeout y cache; una respuesta vacia ya no se marca como exitosa. |
| Django REST + Librosa | Cache y analisis DSP | Sin archivo real el servidor devuelve `AUDIO_REQUIRED`; no genera 120 BPM/8A falsos. |
| Expo Network | Sincronizacion solo por Wi-Fi | Backend de produccion debe definirse con `EXPO_PUBLIC_MILLA_API_URL`. |
| react-native-image-colors | Color de fondo segun caratula | Fallo controlado con color por defecto. |

## Causas de los cierres encontrados

- `screens/NowPlayingModal.tsx` retornaba antes de ejecutar varios hooks. Al abrir la caratula React detectaba un numero distinto de hooks y terminaba la pantalla. Todos los hooks estan ahora antes del retorno condicional.
- `App.tsx` reconstruia la pista activa y descartaba `url`, `artwork_thumb`, `lyrics_json`, `lyrics_lrc`, BPM y Camelot. Ahora conserva la fila completa de SQLite.
- Varios botones del mini reproductor reutilizaban el callback de abrir la caratula; ahora microfono, cola, temporizador, compartir y cast tienen acciones separadas.
- Las acciones aun no implementadas del menu de pista se retiraron de la interfaz. Compartir y Detalles son funcionales.
- El boton Atrás de Android ahora cierra modales, vuelve desde subpantallas de Inicio y recorre el historial de pestañas sin terminar la app.

### Correcciones de estabilidad posteriores

- El permiso de audio ya no se solicita dentro del arranque. SQLite y la primera pantalla se estabilizan
  primero; el dialogo de Android solo se abre desde `Conceder Acceso`, con una unica solicitud en vuelo
  y un fallback seguro si el modulo nativo rechaza la consulta.
- `newArchEnabled` queda desactivado de forma explicita en Expo y Gradle mientras Milla utiliza modulos
  comunitarios que no aportan una ventaja necesaria con la Nueva Arquitectura.

## Biblioteca y caratulas

- La pantalla muestra inmediatamente las pistas recibidas desde `App.tsx`; SQLite solo se consulta al montar si no hay catalogo en memoria.
- La extraccion de caratulas se inicia despues de las interacciones de navegacion, en lotes de dos.
- Cada archivo sin caratula se intenta una sola vez por sesion, evitando el bucle de relectura que congelaba la lista.
- Una caratula invalida activa el fallback pastel con inicial e icono musical.
- Las caratulas extraidas se guardan como archivos de cache y SQLite conserva solo su URI, no blobs Base64 grandes.
- El escaneo manual ya no elimina las canciones indexadas desde otras carpetas.

## Seek y letras

- Los sliders mantienen un valor local mientras el usuario arrastra; el progreso nativo ya no empuja el thumb hacia atras durante el gesto.
- El seek se limita a la duracion valida y cualquier error nativo queda capturado.
- El microfono abre directamente Letras desde el mini reproductor y desde Now Playing.
- El modo Onda usa el componente oficial `am-lyrics`, autoscroll, interpolacion y `requestAnimationFrame`.
- Tocar una linea envia su tiempo en milisegundos al puente DOM y luego al motor nativo en segundos.
- El boton globo alterna Onda/en linea y LRC local; Actualizar vuelve a consultar; Reloj ajusta el desfase visual.

## Auto Mix

- El interruptor ahora cambia inmediatamente la cola nativa durante la reproduccion.
- La cola mantiene solo una siguiente pista calculada para que la reproduccion automatica siga al Maestro.
- Se corrigio la lectura de `camelot_key`; antes el algoritmo ignoraba la columna real de SQLite.
- Las pistas sin BPM o tonalidad reciben puntuacion neutra en lugar de datos inventados.
- Los modos estricto, energia y libre modifican realmente la puntuacion armonica.
- Se elimino la exclusion mutua que apagaba Auto Mix al configurar crossfade o cross-out.
- El final se desvanece y la pista siguiente recupera gradualmente ReplayGain.
- El pool de AutoMix ya no puede quedar vacio por excluir las ultimas pistas escuchadas: en catalogos
  pequenos usa un fallback de las menos recientes. El controlador de fades serializa los eventos
  de progreso para impedir dos transiciones simultaneas y una cola bloqueada.

El motor actual usa un solo decodificador. Por ello ofrece seleccion armonica y fade secuencial estable, pero no superpone dos audios ni sincroniza beats en paralelo. Un crossfade DJ real con dos canciones simultaneas requiere un modulo nativo de doble deck y analisis fiable de beat-grid, no solo BPM.

## Seguridad y DevOps

- Django obtiene secretos, hosts y CORS desde variables de entorno y rechaza configuracion de produccion incompleta.
- Los nombres de archivos DSP se normalizan y el archivo temporal usa UUID.
- Todas las llamadas de sincronizacion tienen timeout de 8 segundos.
- Produccion no intenta conectarse a `10.0.2.2`; esa direccion queda limitada a desarrollo.
- GitHub Actions usa Node 22.13, compatible con Expo 57, y `npm ci` reproducible.
- Los permisos de imagen/video y almacenamiento de escritura fueron retirados del manifiesto Android.

## Validacion realizada

- `npx tsc --noEmit --skipLibCheck`: correcto.
- `npx expo-doctor --verbose`: 20/20 comprobaciones correctas.
- `npx expo config --type public`: configuracion y plugins resueltos correctamente.
- `npx expo export --platform android`: bundle Hermes y bundle DOM generados correctamente.
- `npm audit --omit=dev`: sin vulnerabilidades altas o criticas; quedan 16 moderadas transitivas cuya correccion propuesta degrada Expo y no es compatible.

## Validacion pendiente en hardware

La compilacion estatica no puede sustituir una prueba con la biblioteca real del telefono. El APK debe probarse al menos con Android 11, Android 13+ y, si aplica, una tarjeta SD. Proveedores SAF distintos de `com.android.externalstorage.documents` se copian byte a byte al cache privado de la app para reproducirlos; el cache se limita y conserva la URI original para poder regenerarse. La compilacion Gradle local sigue pendiente por falta de espacio libre en disco.
