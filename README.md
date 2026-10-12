# Pa' Donde

> Tú dices pa’ dónde. Nosotros te llevamos.

Rutas de buses de Barranquilla y su área metropolitana sobre un mapa: Transmetro (datos de
OpenStreetMap) y buses tradicionales (datos del AMB), con "Cómo llegar" y el valor del pasaje.

## Correr la app

Tiene que servirse por HTTP (abriendo `index.html` con doble clic no carga los datos):

```bash
python scripts/servidor.py
```

y abrir http://localhost:8000. Este servidor le pide al navegador que no use versiones
viejas guardadas en caché (con `python -m http.server` a veces se quedan pegadas).
"Cerca de mí" necesita `localhost` o HTTPS para pedir la ubicación.

### Instalarla como app

La app se puede instalar (PWA): `manifest.webmanifest` le da nombre, ícono y colores, y
`sw.js` guarda la app y sus datos para que abra sin internet (los mapas de fondo no, por la
política de uso de OpenStreetMap). En Chrome o Edge aparece el botón **Instalar** en el
encabezado; en iPhone se instala desde Safari con Compartir → Agregar a inicio.

La instalación y el modo sin internet solo funcionan en `localhost` o con HTTPS: en el
celular por `http://192.168…` no, hasta publicarla en un sitio con HTTPS.

Los íconos se generan a partir de `assets/icono.svg` con:

```bash
python scripts/generar_iconos.py
```

"Tus lugares" (Casa, Trabajo, favoritos), "Tus rutas" y "Recientes" se guardan solo en el
navegador de cada persona (`localStorage`), no en un servidor.

### Cómo llegar: salida y llegada

Cada viaje tiene **Desde** y **Hasta**. Cada campo acepta un lugar buscado, "Mi ubicación",
"Elegir en el mapa", un lugar guardado o uno reciente; ⇅ los intercambia. En el mapa, mantener
presionado (o clic derecho) abre "Salir desde aquí / Llegar aquí", y los puntos de salida y
llegada se pueden arrastrar. A los puntos marcados en el mapa se les pone el nombre de la
calle más cercana (Photon). El botón junto al buscador empieza un viaje desde cero.

### Compartir, reportar errores y guía

- **Compartir**: cada ruta (`#ruta/…`) y cada viaje (`#viaje/lat,lon/nombre`) tiene su enlace.
  El enlace de un viaje lleva solo el destino, nunca el punto de partida. En el celular
  (con HTTPS) se abre el menú de compartir del sistema; si no, una ventana con WhatsApp y
  "Copiar enlace". Ojo: mientras la app no esté publicada, los enlaces solo abren en este
  computador o en la misma red Wi-Fi.
- **Reportar un error**: el botón aparece en la ficha de cada ruta cuando `REPORT_TO` (al
  comienzo de `app.js`) tiene un correo o un WhatsApp. El reporte llega con la ruta, la
  parada resaltada, el problema y el comentario ya escritos. Hoy está vacío: el botón no se ve.
- **Guía**: tres pasos que se muestran la primera vez; se pueden volver a ver con
  "¿Cómo se usa?".

### Verla en el celular

```bash
python scripts/servidor.py --red
```

Imprime la dirección para el celular (por ejemplo `http://192.168.68.108:8000`); el
celular tiene que estar en la misma red Wi-Fi. Si no carga: en Windows, la red Wi-Fi debe
estar como **privada** y Python permitido en el firewall.

Por `http://` el navegador del celular no deja usar la ubicación. En Chrome para Android
se puede habilitar para pruebas: abrir `chrome://flags/#unsafely-treat-insecure-origin-as-secure`,
activarlo, escribir la dirección (`http://192.168.68.108:8000`) y reiniciar Chrome. Mientras
tanto, mantener presionado el mapa muestra las rutas cerca de cualquier punto.

## Publicar en Netlify

`scripts/preparar_publicacion.py` arma la carpeta `publicar/` solo con lo que necesita la
página (unos 1,4 MB): sin los scripts ni los datos intermedios. También le pone una versión
nueva al service worker, para que los celulares que ya instalaron la app reciban la
actualización, y agrega el archivo `_headers` con los encabezados de seguridad.

### Con un repositorio de GitHub (recomendado)

Netlify lee `netlify.toml`, corre ese script por su cuenta en cada `git push` y publica
`publicar/`. La carpeta `publicar/` no se sube al repositorio (está en `.gitignore`).

La primera vez:

1. En [github.com/new](https://github.com/new), crear un repositorio vacío (sin README, sin
   `.gitignore` y sin licencia, porque ya están en el proyecto). Puede ser privado: Netlify
   publica igual desde repositorios privados.
2. Subir el proyecto (cambiar `USUARIO` por el usuario de GitHub). La primera vez, Windows
   abre el navegador para iniciar sesión en GitHub:

   ```bash
   git remote add origin https://github.com/USUARIO/pa-donde.git
   git push -u origin main
   ```

3. En [app.netlify.com](https://app.netlify.com): *Add new site → Import an existing project →
   GitHub*, autorizar a Netlify y elegir el repositorio `pa-donde`. Netlify llena solo el
   comando (`python3 scripts/preparar_publicacion.py`) y la carpeta (`publicar`) desde
   `netlify.toml`: solo hay que darle *Deploy*.
4. Netlify da una dirección como `https://nombre-al-azar.netlify.app`; se puede cambiar en
   *Site configuration → Change site name*. No hay que hacer nada más: en cada publicación
   el script recibe la dirección del sitio (variable `URL`) para la vista previa al
   compartir por WhatsApp.

Después, para publicar un cambio:

```bash
git add -A
git commit -m "Describe el cambio"
git push
```

Netlify vuelve a publicar solo en uno o dos minutos.

### Arrastrando la carpeta (sin GitHub)

1. Correr `python scripts/preparar_publicacion.py --url https://tu-sitio.netlify.app` (la
   dirección se conoce después de la primera subida; sin ella, la vista previa al compartir
   puede salir sin imagen).
2. En [app.netlify.com](https://app.netlify.com), con una cuenta (los sitios subidos sin cuenta
   se borran al rato), arrastrar la carpeta `publicar/` al recuadro de subir archivos.
3. Para cada cambio: correr el script otra vez y arrastrar `publicar/` en *Deploys*.

Al estar en `https://`, en el celular funcionan la ubicación ("Cerca de mí"), instalar la
app y abrirla sin conexión.

Antes de publicarla para todo el mundo, conviene tener en cuenta:

- Las rutas de buses tradicionales son del AMB: su uso está permitido para fines personales
  y no comerciales con crédito; para un uso comercial hay que pedir autorización escrita.
- El mapa usa los mosaicos de OpenStreetMap y el buscador usa Photon, que son gratuitos para
  un uso moderado. Si la app tiene mucho tráfico, habría que pasar a un proveedor de mapas
  propio o pagado.
- El botón "Reportar un error" sigue oculto hasta llenar `REPORT_TO` en `app.js`.

## Actualizar los datos

```bash
python scripts/descargar_rutas.py
```

Genera `data/rutas.geojson`: cada ruta con sus tramos ya orientados en el sentido de
circulación, las calles por donde pasa y sus estaciones y paradas en orden (las paradas
con nombres genéricos como "Parada A9-3" se nombran por su calle). Si los servidores públicos de Overpass
están caídos, reutiliza la lista de rutas del archivo actual y las paradas guardadas en
`data/paradas_osm.json`.

### Buses colectivos (AMB)

```bash
python scripts/descargar_rutas_amb.py
```

Genera `data/rutas_amb.geojson` con los recorridos que publica el Área Metropolitana de
Barranquilla en su [visor de rutas](https://www.ambq.gov.co/transporte/transporte-publico-colectivo/)
(89 recorridos de 23 empresas). Traen el trazado pero no las paradas. "Por dónde pasa" se calcula
cruzando el trazado con las calles con nombre de OpenStreetMap (guardadas en `data/calles_osm.json`
por si Overpass no responde en la próxima actualización). Sus condiciones de uso
permiten el uso personal y sin fines comerciales mencionando que los datos son del AMB; para
un uso comercial hay que pedirle autorización escrita.

### Lugares para el buscador

```bash
python scripts/descargar_lugares.py
```

Genera `data/lugares.json` con barrios, universidades, centros comerciales, hospitales,
parques, estadios… de OpenStreetMap. El buscador los sugiere al instante mientras se escribe
y completa con [Photon](https://photon.komoot.io), un buscador de OpenStreetMap hecho para
buscar mientras se escribe (se consulta cuando se deja de escribir, no en cada letra).

### Fotos de la placa y del bus

En Barranquilla la gente reconoce los buses tradicionales por la placa (el cartel con la ruta
en la ventanilla), así que la ficha de cada ruta tradicional tiene un carrusel con la foto de
la placa y la del bus. Mientras una ruta no tenga fotos, el carrusel dice "Próximamente".

Para agregarlas:

1. Poner las fotos en la carpeta `fotos/` (en la raíz del proyecto), nombradas con el código
   de la ruta tal como sale en la app: `C14-placa.jpg`, `C14-bus.jpg` y, si hay más de una del
   mismo tipo, `C14-placa-2.jpg`. La ida y la vuelta de una ruta comparten las fotos. Sirven
   JPG, PNG y WebP (en iPhone, las fotos HEIC hay que pasarlas a JPG).
2. Correr el script (la primera vez hay que instalar Pillow con `pip install pillow`):

   ```bash
   python scripts/preparar_fotos.py
   ```

   Achica las fotos (máximo 1280 px, unos 50 KB cada una) para que carguen rápido en celulares
   de gama baja, les quita los datos de la cámara, incluida la ubicación GPS donde se tomaron, y
   las deja en `assets/fotos/` con el índice `data/fotos.json`. Avisa si algún nombre está mal
   escrito o no corresponde a ninguna ruta.
3. Subir los cambios (`git add -A`, `git commit`, `git push`). La carpeta `fotos/` con los
   originales no se sube a GitHub; solo las versiones livianas.

Para que el carrusel aparezca solo en las rutas que ya tienen fotos (sin "Próximamente"),
cambiar `PHOTO_PLACEHOLDERS` a `false` al comienzo de `app.js`.

### Pasaje

El valor del pasaje y los festivos están al comienzo de `app.js` (`FARE` y `FESTIVOS`).
Hay que actualizarlos cada año cuando el AMB anuncie la nueva tarifa (2026: $3.700 de lunes
a sábado y $3.800 domingos y festivos, igual en colectivos y Transmetro).

## Archivos

- `index.html`, `styles.css`, `app.js`: la app (Leaflet + Leaflet.PolylineDecorator).
- `planner.js`: "Cómo llegar": rutas directas o con un transbordo entre dos puntos, respetando
  el sentido de cada bus. Funciones puras, se pueden probar con Node.
- `scripts/descargar_lugares.py`: descarga los lugares que sugiere el buscador.
- `assets/icono.svg`: ícono de la marca, también usado como favicon.
- `scripts/descargar_rutas.py`: descarga y prepara los datos de OpenStreetMap.
- `scripts/descargar_rutas_amb.py`: descarga los buses colectivos del AMB.
- `scripts/preparar_fotos.py`: prepara las fotos de la placa y del bus de cada ruta tradicional.
- `scripts/generar_iconos.py`: dibuja los íconos de la app y la imagen de vista previa al compartir.
- `scripts/servidor.py`: servidor para probarla en el computador o el celular.
- `scripts/preparar_publicacion.py` y `netlify.toml`: publicación en Netlify.
- `data/`: datos generados.

Datos © colaboradores de OpenStreetMap (ODbL) y © Área Metropolitana de Barranquilla (buses colectivos).
