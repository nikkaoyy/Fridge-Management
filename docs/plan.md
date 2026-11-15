# Plan de construcción del Catálogo de nevera

Entregable del bloque 3 de `PEDIDO-NEVERA-0.md`. El modelo está en `docs/modelo-relacional.md` y `db/esquema.sql`; el
contrato en `api/openapi.yaml`. Este documento dice en qué orden se construye, qué decisiones siguen abiertas y
esperan la firma de Nico, qué haría falta de verdad para identificar productos por foto, y qué puede salir mal.

Fecha de redacción: 2026-11-15. Nada de lo que sigue es código: la construcción empieza en `PEDIDO-NEVERA-2`.

## 1. Fases

Dos numeraciones conviven y conviene no confundirlas:

| Numeración | Qué numera | Valores |
|---|---|---|
| Contrato (`api/openapi.yaml`) | Qué endpoints se implementan ya y cuáles solo se declaran | Fase 1 implementada; fase 2 declarada (`x-estado: declarado`, responde 501) |
| Plan (este documento) | En qué orden se construye | F1 API y esquema → F2 dashboard de vencimientos → F3 recetas → F4 vista 3D |

La fase 2 del contrato (proveedores, precios, recetas, planes, `GET /recetas/sugeridas`) se implementa en F3 del plan.

### F0 — Planeación (este pedido, hecha)

Modelo a 5FN, DDL, diagrama, contrato, plan y verificación. Criterio: los cuatro bloques commiteados, el DDL aplica
limpio, el contrato valida y cada campo del contrato tiene columna o derivación en el esquema
(`docs/contrato-vs-modelo.md`).

### F1 — API y esquema (`PEDIDO-NEVERA-2`)

Qué se construye: FastAPI + SQLite en el puerto 8451, con `db/esquema.sql` aplicado al arrancar y `db/referencia.sql`
la primera vez. Los 27 endpoints de fase 1 del contrato (salud, indicadores, catálogo, productos y vida útil,
presentaciones, elementos con alta rápida y `por_vencer`, resumen de vencimientos, movimientos, importador). Los
endpoints de fase 2 del contrato existen y responden 501 con el error uniforme.

Criterio de aceptación, medible:

1. `GET /salud` responde `esquema: 1` (`PRAGMA user_version`) sobre una base recién creada; la conexión tiene
   `PRAGMA foreign_keys = ON` y una prueba lo demuestra intentando un elemento con `ubicacion_id` inexistente (debe
   fallar con 404 o 400, nunca escribir).
2. Una batería de pruebas contra el contrato (pytest + cliente de FastAPI, o Schemathesis apuntando a
   `api/openapi.yaml`) pasa para los 27 endpoints de fase 1 y confirma 501 en los 11 declarados. Ninguna respuesta
   trae un campo que no esté en el contrato.
3. Alta rápida: `POST /elementos` con solo `presentacion_id` y `ubicacion_id` crea el elemento, la compra del día y
   la línea de compra; con `vencimiento` ausente y vida útil declarada devuelve `vencimiento_origen: estimado` con la
   regla de `docs/modelo-relacional.md` §4, verificada a mano en una prueba con factores conocidos.
4. Importador: un CSV con una fila mala responde 400 con `detalle.fila` y deja la base exactamente como estaba
   (conteo de filas de `elemento`, `compra` y `producto` idéntico antes y después). `?simular=1` nunca escribe.
5. Unidades canónicas: `POST /elementos` con `cantidad: 0.2, unidad: kg` y con `cantidad: 200, unidad: g` produce el
   mismo `cantidad_inicial = 200`; una unidad de otra magnitud devuelve 400.
6. El repositorio no contiene ninguna base con datos: el archivo `.db` está en `.gitignore` y las pruebas usan una
   base temporal que se borra.

Queda fuera de F1: cualquier pantalla, precios por proveedor, recetas, 3D, fotos. Las decisiones D1, D3 y D4 tienen
que estar firmadas **antes** de F1 porque cambian cuántas filas crea `POST /elementos` y qué hace la vista de saldo
(ver §2).

### F2 — Dashboard de vencimientos (React + Vite + TypeScript)

Qué se construye: la primera pantalla. Arriba el resumen de `GET /vencimientos` (vencidos, vencen hoy, próximos N
días, sin vencimiento); debajo la lista de `GET /elementos?por_vencer=N` con producto, presentación, etiqueta,
ubicación y días; el formulario de alta rápida; y la merma en dos acciones (elegir elemento, confirmar motivo).

Criterio de aceptación, medible:

1. Alta rápida completa (producto por búsqueda de texto, presentación, ubicación, vencimiento) en 20 segundos o menos
   cronometrados por Nico con el teléfono, en diez altas seguidas, con el catálogo ya cargado. Si una tarda más, se
   anota cuál campo.
2. El panel se pinta con dos llamadas (`/vencimientos` y `/elementos?por_vencer=`), sin lógica de vencimiento
   duplicada en el front: los tramos vienen del servidor.
3. Registrar una merma: dos toques desde la lista; el elemento desaparece de «disponibles» sin recargar.
4. Funciona en el navegador del teléfono en la red de la casa (misma máquina, puerto 8451), con el servidor de Vite
   solo en desarrollo y el `build` servido por FastAPI en producción.

Queda fuera de F2: 3D, recetas, precios, fotos, cuentas de usuario, notificaciones push. Si D5 se firma, en F2 entra
solo el botón de «tomar foto» que guarda el archivo (sin modelo detrás).

### F3 — Recetas (fase 2 del contrato) y precios

Qué se construye: `receta`, `receta_version`, `receta_ingrediente`, `plan_comida`, `GET /recetas/sugeridas`
(consulta 2 de `docs/verificacion.md`), y después proveedores y `precio` por presentación. Pantalla: lista de
recetas sugeridas ordenadas por ingredientes por vencer, y detalle de receta con «tienes / te falta».

Criterio de aceptación, medible:

1. Editar una receta crea la versión N+1; un `plan_comida` creado antes sigue apuntando a la versión N y devuelve sus
   ingredientes originales (prueba automatizada).
2. `GET /recetas/sugeridas?dias=3` devuelve, para una base de prueba temporal con tres recetas y dos elementos por
   vencer, el orden esperado y los conteos `disponibles` y `por_vencer` correctos, y lo hace con la consulta de
   `docs/verificacion.md`, no con un bucle en Python por receta.
3. El precio vigente de una presentación por proveedor es el de `MAX(vigente_desde) <= hoy`; cambiar el precio no
   toca `compra_linea` (lo pagado es historia).

Queda fuera de F3: sustituciones de ingredientes (la ficha las menciona, el pedido no las pide; extensión futura),
nutrición, importar recetas de la web, lista de compras automática.

### F4 — Vista 3D (piel de PYTHAGORAS)

Qué se construye: la nevera en 3D con un objeto por elemento disponible, agrupado por `ubicacion` (nevera, puerta,
cajón, congelador, despensa, frutero), coloreado por `dias_para_vencer`, y al tocar un objeto se abre el elemento.
Reutiliza la piel de PYTHAGORAS (shaders, cámara, texturas): el mismo motor de render, los mismos materiales, la misma
cámara orbital. No se escribe un segundo motor ni se evalúan alternativas.

Criterio de aceptación, medible:

1. La escena pinta todos los elementos con saldo > 0 de `GET /elementos` y nada más: el conteo de objetos coincide
   con `Indicadores.elementos_disponibles`.
2. Con 200 elementos, 30 cuadros por segundo o más en el portátil de Nico y 20 o más en el teléfono (se mide con el
   contador de cuadros del motor, no a ojo).
3. Tocar un objeto abre el mismo detalle que en F2; registrar una merma desde la 3D usa el mismo `POST /movimientos`.
4. Ninguna textura ni shader está duplicado respecto a PYTHAGORAS: se importa de su paquete o se copia una sola vez
   con la ruta de origen documentada.

Queda fuera de F4: posición física real (depende de D2; con «esquemática» la 3D ordena, no reproduce), simulación
física, iluminación realista, modelos por producto (un paralelepípedo o cilindro por presentación basta).

Dependencia no verificada: el repositorio de PYTHAGORAS no está en `/opt/data/apps`, así que no se pudo comprobar qué
motor usa ni cómo se empaqueta su piel. Antes de F4 hay que fijar la ruta y la forma de importarla (riesgo R4).

### Después de F4, sin planificar

Identificación por foto (§3) y OCR de la fecha impresa. No tienen fase porque dependen de datos que hoy no existen.

## 2. Decisiones que necesitan la firma de Nico

Ninguna de estas se cierra aquí. El modelo y el contrato soportan todas las opciones; lo que cambia es cuántas filas
se crean, qué hace la interfaz y qué cuesta cambiar de opinión después. La columna «cuándo» dice antes de qué fase
hace falta la firma.

| ID | Pregunta | Opciones | Recomendación | Coste de elegir la otra | Cuándo |
|---|---|---|---|---|---|
| **D1** | **Lote vs unidad física.** ¿Seis bolsas de leche compradas juntas son seis filas de `elemento` o una con `cantidad_inicial = 6 × 1000 ml`? | (a) Unidad física: una fila por cosa. (b) Lote: una fila por línea de compra. | **(a) Unidad física.** Es la única que responde las cinco preguntas del ruido: «cuál está abierta», «cuál es cuál», y la 3D pinta seis bolsas. «Cuántas quedan» es un `COUNT`. | Con (b) se pierde `abierto_en` por bolsa (ruido 2), la etiqueta «la de la puerta» no tiene a qué pegarse (ruido 4) y la 3D solo puede pintar «un lote de 6». El consumo «me tomé una bolsa» se vuelve «resta 1000 ml». Pasar de (b) a (a) después **no se puede reconstruir**: no se sabe cuál de las seis se abrió. Pasar de (a) a (b) es agrupar, trivial. El coste de (a) es volumen: 6 filas en vez de 1, y la lista del panel necesita agrupar «leche × 6» visualmente. | Antes de F1 |
| **D2** | **Posición física en la 3D vs vista esquemática.** ¿La nevera 3D reproduce dónde está cada cosa, o la ordena por ubicación? | (a) Esquemática: la app asigna el sitio dentro de la `ubicacion` (puerta, balda, cajón). (b) Física: cada elemento guarda coordenadas o compartimento exacto, capturado a mano. | **(a) Esquemática.** `ubicacion` jerárquica ya llega a «balda 2 de la nevera» sin coordenadas; la escena coloca los objetos con una regla fija y queda siempre al día. | Con (b) hace falta una tabla `elemento_posicion` (x, y, z o compartimento) y capturar la posición en cada alta y cada vez que algo se mueve; es el dato que envejece (riesgo R1): a la semana la 3D miente. Con (a) la 3D no es una foto de la nevera: dice «en la puerta» pero no «tercera botella desde la izquierda»; si se quiere más granularidad, se añaden ubicaciones hijas (balda, rejilla), no coordenadas. Cambiar de (a) a (b) después es añadir una tabla, sin pérdida. | Antes de F4 (puede esperar) |
| **D3** | **¿El pack se explota en unidades al registrarlo?** Al dar de alta «pack de 12 bolsas», ¿se crean las 12 bolsas como hijos ya, al abrirlo, o nunca? | (a) Al registrar: el pack entra como elemento contenedor y sus 12 hijos a la vez. (b) Al abrir: el pack es un elemento solo; «abrir pack» crea los 12 hijos y vacía el padre con un `ajuste`. (c) Nunca: el pack es un lote (equivale a D1 b para los packs). | **(a) Al registrar**, si D1 es (a). Un solo estado para todas las consultas: lo que vence, lo que usan las recetas y la 3D miran siempre hojas (elementos sin hijos); «abrir el pack» es `abierto_en` en el padre y «abrir una bolsa» es `abierto_en` en el hijo, que es exactamente el ruido 3. Regla que implica: **el saldo se cuenta solo en hojas**; el padre no suma (se añade a `v_elemento` o a la API en `PEDIDO-NEVERA-2`, una línea `NOT EXISTS hijo`). | Con (b) hay dos estados (pack cerrado como una fila de 12 000 ml; pack abierto como 12 filas) y cada consulta, pantalla y la 3D tienen que entender ambos; a cambio, un pack cerrado es una fila y no trece. Con (c) se pierde el ruido 3 entero. Pasar de (a) a (b) es solo dejar de crear hijos al alta; de (b) a (a) exige explotar packs cerrados ya registrados (se puede: todos tienen el mismo vencimiento). | Antes de F1 |
| **D4** | **¿Qué pasa con el consumo a medias?** ¿Se registra «consumí 200 ml» o solo abierto / se acabó / se botó? | (a) Parcial: cada consumo lleva cantidad; el saldo es exacto. (b) Todo o nada: la interfaz ofrece abrir, acabar y botar; `POST /movimientos` sin `cantidad` descuenta el saldo entero. El endpoint acepta ambas desde ya. | **(b) Todo o nada en la interfaz**, con (a) disponible por API para el importador y para quien quiera. Nadie apunta 200 ml de leche a las 7 de la mañana; el dato parcial no se captura y el saldo exacto sería falso. Lo que sí se captura con un toque es «la abrí» y «se acabó», y con `vida_util.dias_abierto` eso ya mueve el vencimiento. | Con (a) obligatoria, cada consumo pide un número; cuando no se apunta, el saldo queda inflado y «recetas sugeridas» cree que hay leche cuando queda un fondo. Con (b), la merma se valora por `cantidad_inicial` entera aunque quedara la mitad (sobreestima el desperdicio en COP) y «disponible» es binario. Mitigación barata si duele: al botar, preguntar «¿quedaba: casi todo / la mitad / poco?» y registrar el `consumo` implícito como un movimiento previo. Cambiar de (b) a (a) no toca el modelo. | Antes de F1 (afecta a la prueba 3 de F1 y a la pantalla de F2) |
| **D5** | **¿Se empieza a guardar fotos desde F2 aunque no haya modelo?** La red neuronal de §3 necesita fotos reales de la casa; o se capturan desde el alta rápida o no existirán. | (a) Sí: botón opcional «foto» en el alta, archivo en disco, tabla `producto_foto(id, producto_id, ruta, tomada_en, elemento_id)` añadida en `PEDIDO-NEVERA-2`. (b) No: la foto se decide cuando se decida el modelo. | **(a) Sí, opcional y sin modelo.** Cuesta una tabla y un botón; sin eso §3 no tiene con qué empezar nunca y las fotos de internet no sirven (otra luz, otro empaque). | Con (b), cuando se quiera el modelo habrá que hacer una sesión de fotos artificial que no representa el uso real, y el mínimo de datos de §3 se alcanza en meses en vez de salir del uso diario. Con (a), cada alta con foto suma unos segundos (contra el criterio de 20 s de F2: por eso es opcional) y hay que gestionar espacio en disco. Si no se firma, no se toca el contrato: hoy no tiene ningún campo de foto. | Antes de F2 |

Lo que **no** es decisión de Nico porque ya está decidido en el pedido: stack, puerto 8451, COP, un hogar sin cuentas,
sin datos de ejemplo, modelo en Oracle Data Modeler, la 3D sobre PYTHAGORAS.

## 3. La red neuronal para identificar productos por foto

Qué problema resuelve y cuál no: dada una foto en el momento del alta, proponer **qué producto del catálogo de
Nico es** (leche X, tomate chonto), para no buscarlo en la lista. No identifica la instancia («cuál de las dos
bolsas»: eso es la etiqueta), no lee la fecha impresa (eso es OCR, otro problema con otra solución), y no inventa
productos que no estén en el catálogo.

### Enfoque: nada de entrenar desde cero

1. **Primero, vecinos más cercanos sobre embeddings.** Un modelo pequeño ya entrenado en ImageNet (MobileNetV3-Small,
   EfficientNet-Lite0 o similar, menos de 10 MB) convierte cada foto en un vector; se guardan los vectores de las fotos
   de cada producto; una foto nueva se compara con todos y se proponen los 3 productos más cercanos. Ventajas: no se
   entrena nada, un producto nuevo entra con sus fotos y ya está, y funciona con pocas fotos por producto. Es lo que
   hay que probar primero porque el coste es casi cero.
2. **Después, si hace falta, transfer learning.** Congelar el tronco del mismo modelo y entrenar solo la cabeza
   (clasificador de K productos); ajustar las últimas capas únicamente si hay datos de sobra. Mejora sobre el paso 1
   cuando hay empaques parecidos (misma marca, entera vs deslactosada), que es justo donde el paso 1 falla.
3. **Nunca** una arquitectura propia ni entrenamiento desde cero: con cientos de fotos no hay con qué.

### Datos: lo que haría falta de verdad

- **Fotos por producto.** Para el paso 1, entre 10 y 20 fotos por producto ya permiten una prueba honesta. Para el
  paso 2, el orden de magnitud habitual es 50 a 100 por producto; con menos, el modelo memoriza y el número de la
  evaluación engaña.
- **Variación obligatoria, no opcional.** Las fotos de un producto tienen que repartirse entre: tres condiciones de
  luz (luz de día en la cocina, luz artificial de noche, la luz de la nevera abierta), al menos cuatro ángulos
  (frente, 45°, lateral, desde arriba), tres fondos (dentro de la nevera, sobre el mesón, en la mano), y dos estados
  (cerrado, abierto o a medias). Y con los teléfonos que de verdad se usan en la casa. Diez fotos del mismo ángulo
  con la misma luz cuentan como una.
- **Sesiones separadas para evaluar.** Las fotos de evaluación se toman otro día, en otra sesión; nunca se parte una
  misma sesión entre entrenamiento y prueba, porque las fotos consecutivas son casi iguales y el número que sale es
  falso.
- **Métricas a medir antes de prometer nada**: acierto en el primer candidato y en los tres primeros, sobre la
  evaluación por sesiones. Hasta tener esos dos números medidos, la interfaz muestra los tres candidatos y el usuario
  elige; nunca rellena sola. **No se escribe aquí ninguna cifra de precisión**: no se ha medido.

### Dónde correría

- **Servidor (recomendado para empezar).** El mismo FastAPI en 8451, con ONNX Runtime en CPU. La foto viaja por la red
  de la casa (un hogar, sin salir de la LAN), la inferencia tarda decenas de milisegundos, y cambiar de modelo es
  cambiar un archivo en el servidor. No hay que empaquetar nada en el navegador.
- **Teléfono (después, si la latencia molesta).** El mismo modelo exportado a ONNX Runtime Web o TensorFlow.js en la
  app React; funciona sin red y no sube la foto. Cuesta el tamaño del modelo en la descarga inicial y una ruta de
  despliegue aparte. No se justifica hasta que el servidor demuestre que la idea sirve.

### El mínimo por debajo del cual no vale la pena

- **Menos de 10 fotos por producto, repartidas en al menos dos sesiones distintas**: no hay ni para probar el paso 1
  con honestidad.
- **Menos de unos 30 productos con fotos**: buscar por nombre con dos letras tarda tres segundos; sacar el teléfono,
  encuadrar y confirmar tarda más. El modelo tiene que ganarle a esa barra, y con un catálogo pequeño no gana.
- **Catálogo dominado por productos sin empaque** (fruta y verdura a granel): tomate chonto y tomate larga vida se
  parecen más entre sí que dos marcas de leche, y la ganancia frente a escribir «tom» es nula. Si eso es la mayoría
  del catálogo, no vale la pena en absoluto.
- **Sin D5 firmada no hay datos**, y sin datos no hay fase. El orden es: fotos reales del uso diario → medir el
  paso 1 → decidir si merece el paso 2.

Alternativa con mejor relación coste-beneficio que conviene mirar antes que el reconocimiento de producto: OCR de la
fecha impresa con una biblioteca existente, porque la fecha es el dato que más cuesta teclear y el que más duele si
está mal. No está en este pedido; se anota para no olvidarlo.

## 4. Riesgos con nombre

| ID | Riesgo | Cómo se nota | Qué se hace |
|---|---|---|---|
| **R1** | **La posición física se captura a mano y envejece.** Si D2 se firma como «física», cada vez que alguien mueve una bolsa sin decirlo la 3D miente, y nadie lo dice. | Al comparar la 3D con la nevera abierta: a la semana no coinciden. | Recomendar D2 (a) esquemática. Si se elige (b), guardar `actualizado_en` por posición y pintar en gris lo que lleva más de N días sin confirmar, para que la mentira se vea. |
| **R2** | **La vida útil de frutas y verduras no tiene base empírica.** `dias_base` y los factores de madurez y conservación los pone el usuario; no hay tabla científica detrás, y un factor mal puesto estima vencimientos falsos en silencio. | Mermas con `motivo = vencido` en elementos cuyo `vencimiento_origen = estimado` y que aún estaban buenos, o al revés: cosas dañadas antes de la fecha estimada. | `vida_util.fuente` obliga a decir de dónde salió el número. Desde F2, al botar un elemento estimado se pregunta «¿estaba bueno?»; con eso, en unos meses, cada producto tiene su propia evidencia y se ajusta `dias_base` con datos de la casa, no de internet. Mientras tanto, los estimados se pintan distinto a los impresos. |
| **R3** | **El importador es la única puerta de entrada masiva.** Si el CSV de Nico no cuadra con el formato del contrato, o trae nombres con variantes («Leche», «leche entera», «LECHE»), el catálogo nace duplicado o no nace. | `productos_nuevos` del resumen de importación con nombres casi iguales; `omitidos` largo. | `?simular=1` antes de cada importación real; nombre de producto único sin distinguir mayúsculas (ya está en el DDL); el resumen lista los productos que crearía para revisarlos antes. Todo o nada: una fila mala no deja medio catálogo. Y el alta rápida es la segunda puerta desde F1, para que el importador no sea bloqueante. |
| **R4** | **La piel de PYTHAGORAS no está a la mano.** No está en `/opt/data/apps` y no se sabe qué motor usa ni cómo se empaqueta. F4 depende de eso. | Al empezar F4 no hay un paquete importable. | Antes de F4: Nico indica la ruta del repo; se comprueba que el motor es compatible con React + Vite y se decide si se importa como paquete o se copia una vez con origen documentado. No se evalúan motores alternativos: la decisión está tomada. |
| **R5** | **D1 (a) multiplica filas y toques.** Con unidad física, una compra grande son decenas de elementos; si el alta rápida no crea en lote y la lista no agrupa, el panel se vuelve ruido y la gente deja de registrar. | Altas que superan los 20 s del criterio de F2; elementos sin etiqueta ni ubicación precisa porque se registraron de prisa. | `unidades` en `POST /elementos` crea en lote con un solo formulario; la lista agrupa por producto y presentación («leche × 6, la más próxima vence el 20»); el detalle muestra las seis. |

## 5. Qué falta para empezar a codificar (`PEDIDO-NEVERA-2`)

1. Firma de **D1, D3 y D4** (antes de F1). D2 puede esperar a F4; D5 a F2.
2. Si D3 es (a): añadir la regla «el saldo se cuenta solo en hojas» a `v_elemento` o a la API; es la única variación
   del esquema que depende de una firma.
3. Nico coteja el diagrama de `docs/modelo-relacional.md` §5 contra su dibujo en Oracle Data Modeler y reporta
   diferencias; no bloquea F1.
4. Nada más: el DDL aplica limpio, el contrato valida y las consultas clave están escritas y medidas
   (`docs/verificacion.md`). Los datos reales para el importador no hacen falta para construir: hacen falta para usar.
