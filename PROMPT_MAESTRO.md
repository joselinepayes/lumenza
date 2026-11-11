# PROMPT MAESTRO — DESARROLLO INTEGRAL DE LUMENZA

> Texto original proporcionado por el usuario al inicio del proyecto (copiado íntegro, sin modificaciones de contenido). Las reglas operativas derivadas están en `CLAUDE.md`.

## 1. IDENTIDAD DEL PROYECTO

Actúa como un equipo multidisciplinario de alto nivel integrado por:

* Arquitecto de software senior.
* Ingeniero frontend especializado en React.
* Ingeniero backend especializado en Node.js y Express.
* Diseñador UX/UI especializado en productos digitales premium.
* Ingeniero de bases de datos relacionales.
* Ingeniero DevOps especializado en Docker, Kubernetes y Azure.
* Especialista en seguridad web.
* Ingeniero de QA y pruebas automatizadas.

Tu misión es desarrollar desde cero una red social de fotografías llamada LUMENZA, cuyo eslogan será:
«Cada mirada cuenta una historia».
No quiero un proyecto universitario genérico, una plantilla de dashboard ni una interfaz improvisada.
Quiero una aplicación web auténtica, elegante, visualmente extraordinaria, funcional, segura, responsiva y técnicamente sólida.
La inspiración principal para la experiencia de usuario será Instagram, especialmente su enfoque en contenido visual, perfiles, publicaciones, exploración, relaciones sociales e interacciones.
Sin embargo, LUMENZA debe tener identidad propia, una arquitectura diferenciada y un sistema de diseño original. No copies literalmente la interfaz, el logotipo, las ilustraciones ni los recursos de Instagram.
El resultado debe sentirse como una plataforma tecnológica real, desarrollada por una empresa con estándares de calidad profesionales.

## 2. OBJETIVO ACADÉMICO OBLIGATORIO

El proyecto debe satisfacer los requisitos establecidos para el proyecto final de Desarrollo Web:

1. Página de bienvenida, registro y autenticación.
2. Integración de Google Login y reCAPTCHA.
3. Página principal con miniaturas de fotografías.
4. Subida de nuevas imágenes.
5. Reconocimiento de imágenes mediante herramientas como face-api.js u OpenCV.
6. Generación automática de tres transformaciones diferentes por fotografía.
7. Visualización de la fotografía original y sus transformaciones.
8. Almacenamiento de fotografías en la nube sin guardar los archivos binarios en la base de datos.
9. Base de datos relacional para usuarios, fotografías y sus ubicaciones.
10. Contraseñas almacenadas mediante hash seguro con sal individual.
11. Despliegue en Docker y en un proveedor de nube.
12. Documentación técnica, arquitectónica, de despliegue y de usuario.

El documento académico menciona específicamente Amazon S3 y varios entregables relacionados con AWS EC2. Se permite considerar Azure para el despliegue, pero no se debe asumir que Azure Blob Storage sustituye automáticamente el requisito literal de S3 sin autorización docente.
La arquitectura debe permitir utilizar Amazon S3 y desplegar la aplicación en Azure AKS o AWS, según la decisión final.
No elimines ni simplifiques los requisitos académicos para incorporar funcionalidades adicionales.

## 3. IDENTIDAD VISUAL — NIVEL PRODUCTO PREMIUM

### Estética general

Diseña una experiencia visual original inspirada en:

* Fotografía editorial contemporánea.
* Interfaces minimalistas de productos tecnológicos premium.
* Composiciones cuidadosamente equilibradas.
* Fotografía de gran formato.
* Tipografía moderna y jerarquías claras.
* Espaciados generosos y consistentes.
* Animaciones refinadas.
* Microinteracciones suaves.
* Superficies elegantes, profundidad sutil y detalles luminosos.

Evita completamente:

* Dashboards administrativos genéricos.
* Tarjetas repetitivas sin criterio visual.
* Botones excesivamente redondeados.
* Gradientes exagerados.
* Uso indiscriminado de glassmorphism.
* Sombras intensas en todos los componentes.
* Emojis como sustitutos de iconos.
* Interfaces saturadas.
* Componentes visualmente inconsistentes.
* Diseños que parezcan ejemplos básicos de tutoriales.

### Paleta propuesta

Modo oscuro:

* Fondo principal: #0B0B10
* Superficie elevada: #15151D
* Superficie secundaria: #1D1D29
* Texto principal: #F8F8FC
* Texto secundario: #A3A3B5
* Acento violeta: #9673F7
* Acento lila: #C4B5FD
* Divisores: #292936

Modo claro:

* Fondo principal: #FAFAFD
* Superficies: #FFFFFF
* Texto principal: #181821
* Texto secundario: #737386
* Acento violeta: #7654D7
* Bordes: #E8E8F0

Los colores deben implementarse mediante tokens de diseño reutilizables y respetar contraste y accesibilidad.

### Tipografía

Utilizar una familia tipográfica profesional como Inter o una alternativa de excelente legibilidad.
El logotipo LUMENZA debe tener tratamiento tipográfico distintivo y una marca gráfica original.

### Principios de diseño

Cada pantalla debe tener un objetivo visual claro.
La fotografía siempre debe ser protagonista.
Diseñar primero el sistema visual y los componentes reutilizables antes de construir todas las páginas.
Crear versiones desktop, tablet y móvil. La experiencia móvil no debe ser simplemente una versión comprimida del escritorio.
Agregar transiciones suaves de 150 a 300 ms, respetando `prefers-reduced-motion`.

## 4. PÁGINAS Y EXPERIENCIAS QUE DEBES DESARROLLAR

### 4.1. Landing pública

La página inicial de LUMENZA debe presentar la plataforma como un producto real.
Incluir:

* Header elegante.
* Logotipo original.
* Hero de alto impacto visual.
* Composición de fotografías destacadas.
* Mensaje de marca.
* Botones de registro e inicio de sesión.
* Animaciones de entrada sutiles.
* Vista previa de las principales funcionalidades.
* Footer profesional.

No utilizar fotografías rotas, contenido genérico incoherente ni imágenes de demostración como si pertenecieran a usuarios reales.

### 4.2. Registro y autenticación

Diseñar una experiencia de autenticación de alto nivel.
Funcionalidades:

* Registro con nombre, username, correo y contraseña.
* Confirmación de contraseña.
* Validación de username único.
* Validaciones de formulario.
* Inicio de sesión.
* Google OAuth.
* Integración de reCAPTCHA con validación del token en backend.
* Recuperación segura de contraseña.
* Verificación de correo.
* Cierre de sesión.
* Manejo de sesiones.
* Estados de error.
* Indicadores de carga.
* Protección contra intentos abusivos.

No simular Google Login: debe existir una integración real y documentada.
No almacenar contraseñas en texto plano.

### 4.3. Home / Feed social

Crear un feed de fotografías con una experiencia de navegación fluida.
Cada publicación deberá permitir:

* Mostrar foto del autor.
* Mostrar username.
* Mostrar fotografía original o versión optimizada.
* Dar y retirar likes.
* Comentar.
* Guardar y retirar de guardados.
* Compartir mediante enlaces.
* Abrir detalles.
* Mostrar fecha.
* Mostrar descripción.
* Mostrar etiquetas.
* Acceder al perfil del autor.
* Menú contextual de acciones permitidas.

El feed debe tener paginación o carga incremental real, estados vacíos, errores y skeleton loaders.
No cargar todas las fotografías de golpe.

### 4.4. Explorar

Implementar una sección visualmente distintiva para descubrir fotografías.
Agregar:

* Cuadrícula visual tipo masonry, cuando resulte adecuado.
* Fotografías destacadas.
* Búsqueda de publicaciones.
* Búsqueda de usuarios.
* Hashtags.
* Filtros por categorías.
* Navegación a publicaciones.
* Resultados organizados.
* Estados sin resultados.

Categorías sugeridas:
Naturaleza, arquitectura, retratos, viajes, arte, fotografía urbana y gastronomía.

### 4.5. Perfil de usuario

Cada usuario tendrá un perfil personalizable.
Debe incluir:

* Foto de perfil.
* Imagen de portada opcional.
* Nombre.
* Username.
* Biografía.
* Estadísticas.
* Publicaciones.
* Seguidores.
* Seguidos.
* Fotografías guardadas, visibles únicamente para el propietario.
* Botón seguir/dejar de seguir.
* Edición de perfil.
* Configuración de cuenta.
* Vista organizada por cuadrícula.

Incluir controles de autorización que impidan editar perfiles ajenos.

### 4.6. Publicar fotografía

Este será uno de los módulos más importantes del proyecto.
Crear una experiencia de publicación mediante modal o flujo de varios pasos.
Permitir:

* Arrastrar y soltar archivos.
* Seleccionar fotografía desde el dispositivo.
* Previsualizar.
* Validar formato y tamaño.
* Añadir descripción.
* Agregar etiquetas.
* Seleccionar una categoría.
* Configurar visibilidad.
* Visualizar el procesamiento.
* Publicar.
* Ver errores.
* Cancelar de forma segura.

No permitir cargas ilimitadas.
Las fotografías deben ser verificadas en el servidor, no únicamente mediante su extensión.

### 4.7. Laboratorio creativo de fotografías

Esta sección será una característica diferencial de LUMENZA.
Al subir una fotografía, el sistema generará automáticamente tres versiones:

1. Blanco y negro editorial.
2. Sepia cinematográfico.
3. Transformación de color y contraste con estilo propio.

Además, generará una miniatura optimizada.
Implementar procesamiento real mediante Sharp u otra herramienta adecuada.
Mostrar:

* Imagen original.
* Tres transformaciones generadas.
* Comparador visual.
* Vista previa.
* Indicador de procesamiento.
* Posibilidad de seleccionar una transformación para visualizarla.
* Información técnica básica de la imagen.
* Descarga autorizada según la configuración de privacidad.

Las transformaciones se almacenarán como archivos independientes y se registrarán en la base de datos.
No generar las tres versiones únicamente con filtros CSS. Deben existir archivos procesados reales.

### 4.8. Reconocimiento de imágenes

Implementar reconocimiento o análisis de imágenes conforme a los requisitos académicos.
Evaluar face-api.js, OpenCV o una alternativa técnicamente adecuada.
Como mínimo, permitir detectar si existen rostros dentro de una fotografía y mostrar resultados visuales mediante cuadros delimitadores.
No implementar identificación biométrica de personas sin consentimiento.
No asumir la identidad, género, etnia ni características sensibles de una persona a partir de su imagen.
No almacenar plantillas biométricas sin una necesidad explícita y justificada.
Si se implementa detección de rostros, informar al usuario sobre el procesamiento.

### 4.9. Notificaciones

Agregar notificaciones reales para:

* Nuevos seguidores.
* Likes.
* Comentarios.
* Actividad relevante.

Permitir marcar como leídas y consultar historial.

### 4.10. Configuración

Incluir:

* Datos personales.
* Cambio de contraseña.
* Preferencia de tema.
* Privacidad del perfil.
* Configuración de notificaciones.
* Administración de sesiones.
* Eliminación de cuenta con confirmación.

## 5. ARQUITECTURA TECNOLÓGICA

Utilizar una arquitectura modular, mantenible y documentada.

### Frontend

Tecnologías preferidas:

* React.
* Vite.
* TypeScript.
* Tailwind CSS.
* React Router.
* TanStack Query.
* React Hook Form.
* Zod.
* Lucide React.
* Framer Motion o Motion, únicamente donde aporte valor.

Implementar un sistema de diseño coherente y componentes reutilizables.

### Backend

Tecnologías preferidas:

* Node.js.
* Express.
* TypeScript.
* Validación mediante Zod u otra solución consistente.
* Autenticación segura.
* Middleware de autorización.
* Manejo centralizado de errores.
* Logs estructurados.
* Rate limiting.
* Helmet y configuración CORS estricta.

Separar responsabilidades:
Routes → Controllers → Services → Repositories → Database.
No colocar toda la lógica en un único archivo.

### Base de datos

Utilizar PostgreSQL.
Diseñar relaciones, claves foráneas, restricciones e índices.
Entidades mínimas:

* Usuario.
* Perfil.
* Sesión.
* Publicación.
* Fotografía.
* TransformaciónImagen.
* Comentario.
* Like.
* Seguidor.
* Guardado.
* Hashtag.
* PublicacionHashtag.
* Notificación.
* RegistroAuditoria.

Documentar el modelo entidad-relación.
Las imágenes nunca se almacenarán como binarios dentro de PostgreSQL.
La base de datos almacenará identificadores, claves de almacenamiento, metadatos, relaciones y estados de procesamiento.

### Almacenamiento de imágenes

Implementar una abstracción StorageService.
Proveedor principal: Amazon S3, para cumplir el requisito del documento académico.
La aplicación debe permitir sustituir el proveedor mediante configuración, sin reescribir la lógica de negocio.
Almacenar:

* Imagen original.
* Miniatura.
* Tres transformaciones.
* Metadatos del objeto.

Usar claves únicas, validación, permisos adecuados y acceso controlado.
No guardar credenciales directamente en el código.

### Procesamiento asíncrono

Para evitar bloquear las solicitudes de subida, diseñar un mecanismo de procesamiento de imágenes mediante cola de trabajos cuando resulte necesario.
Flujo esperado:

1. Usuario sube fotografía.
2. Backend valida el archivo.
3. Imagen original se almacena.
4. Se crea registro con estado pendiente.
5. El procesamiento genera miniatura y tres transformaciones.
6. Las versiones se almacenan.
7. La BD se actualiza con sus rutas y estados.
8. El frontend muestra el resultado.

Manejar fallos, reintentos e imágenes parcialmente procesadas.

## 6. DOCKER Y DESPLIEGUE

El proyecto debe funcionar localmente con Docker.
Crear:

* Dockerfile del frontend.
* Dockerfile del backend.
* Dockerfile del worker si se implementa como servicio independiente.
* docker-compose.yml.
* .dockerignore.
* .env.example.
* Healthchecks.
* Volúmenes para los servicios que lo requieran.

No incluir contraseñas reales en el repositorio.
Docker Compose debe permitir levantar la solución local de forma reproducible, incluyendo PostgreSQL y los servicios adicionales que sean necesarios.

### Despliegue en la nube

Preparar la arquitectura para utilizar Azure AKS, aprovechando la experiencia previa con Kubernetes.
No reutilizar directamente la configuración de CloudStore sin revisar puertos, variables, recursos, probes y dependencias.
Crear manifiestos Kubernetes que incluyan:

* Namespace.
* Deployments.
* Services.
* ConfigMaps.
* Referencias seguras a Secrets.
* Readiness probes.
* Liveness probes.
* Resource requests y limits.

La solución debe permitir escalar horizontalmente las instancias que sean realmente compatibles con ese modelo.
No almacenar fotografías en el disco efímero de un Pod.
Mantener la alternativa de despliegue en AWS, dado que el documento académico solicita elementos específicos de EC2 y S3.
No afirmar que un despliegue está funcionando hasta verificarlo realmente.

## 7. SEGURIDAD OBLIGATORIA

Implementar seguridad desde el inicio, no al final.
Incluir:

* Hash de contraseñas mediante Argon2id o una alternativa robusta.
* Sal individual por contraseña.
* Validación de entradas.
* Autorización de recursos.
* Protección contra carga de archivos maliciosos.
* Restricciones de tamaño y formatos.
* Rate limiting.
* Protección contra XSS.
* Protección CSRF cuando corresponda al modelo de autenticación.
* Cookies seguras, HttpOnly y SameSite cuando corresponda.
* CORS restringido a orígenes permitidos.
* Protección de rutas privadas.
* Tokens y sesiones con expiración.
* Gestión segura de claves.
* Manejo centralizado de excepciones.
* Logs sin contraseñas, tokens ni información sensible.
* Control de acceso a fotografías privadas.

Explicar las decisiones de seguridad implementadas.

## 8. CALIDAD DEL CÓDIGO Y FUNCIONALIDAD REAL

No quiero botones decorativos que no hagan nada.
Cada componente interactivo debe cumplir una función real.
No dejar:

* TODOs críticos.
* Pantallas vacías.
* Rutas rotas.
* Formularios sin backend.
* Datos falsos presentados como reales.
* Credenciales incrustadas.
* Funcionalidades simuladas sin advertirlo.
* Dependencias sin utilizar.
* Código duplicado innecesariamente.
* Errores ignorados.

Implementar estados de:

* Loading.
* Empty.
* Success.
* Error.
* Unauthorized.
* Forbidden.
* Not found.

Añadir pruebas unitarias y de integración en las funcionalidades críticas, además de pruebas de los principales recorridos del usuario.

## 9. EXPERIENCIA RESPONSIVA

### Escritorio

Diseñar una navegación con barra lateral refinada, feed visual, exploración y paneles secundarios cuando aporten valor.

### Tablet

Adaptar la navegación, densidad visual y distribución de columnas.

### Móvil

Crear una navegación inferior nativa en apariencia, transiciones fluidas y una experiencia optimizada para pantallas táctiles.
Probar al menos anchos representativos de 320, 375, 768, 1024 y 1440 píxeles.
Garantizar accesibilidad por teclado, etiquetas de formularios, estados de foco y contraste adecuado.

## 10. DOCUMENTACIÓN ACADÉMICA Y TÉCNICA

Generar documentación profesional en Markdown, organizada y comprobable.
Incluir:

1. README del proyecto.
2. Descripción general de LUMENZA.
3. Tecnologías utilizadas y justificación.
4. Arquitectura del sistema.
5. Diagrama de componentes.
6. Diagrama de despliegue.
7. Modelo entidad-relación.
8. Diccionario de datos.
9. Documentación de endpoints.
10. Manual de instalación local.
11. Manual Docker.
12. Manual de despliegue en la nube.
13. Manual de usuario.
14. Manual técnico.
15. Seguridad y autenticación.
16. Gestión de imágenes y transformaciones.
17. Pruebas y resultados.
18. Plan básico de respaldo y recuperación.
19. Limitaciones conocidas.
20. Evidencias de cumplimiento de la rúbrica académica.

No inventar resultados de pruebas, capturas, credenciales ni despliegues.

## 11. METODOLOGÍA DE DESARROLLO

No quiero que generes todo el proyecto apresuradamente en una sola respuesta.
Trabaja por fases verificables.

**Fase 0 — Análisis**

* Analizar requisitos.
* Identificar restricciones.
* Definir arquitectura.
* Definir diseño visual.
* Preparar matriz de cumplimiento académico.
* Proponer estructura de carpetas.

**Fase 1 — Fundamentos**

* Inicializar repositorio.
* Preparar frontend y backend.
* Configurar TypeScript.
* Configurar PostgreSQL.
* Establecer arquitectura.
* Crear sistema de diseño.

**Fase 2 — Autenticación**

* Usuarios.
* Registro.
* Login.
* Google OAuth.
* reCAPTCHA.
* Sesiones.
* Recuperación.

**Fase 3 — Experiencia social**

* Feed.
* Perfiles.
* Seguidores.
* Likes.
* Comentarios.
* Guardados.
* Exploración.

**Fase 4 — Gestión de fotografías**

* Subida.
* Validación.
* Almacenamiento.
* Miniaturas.
* Transformaciones.
* Visualización.

**Fase 5 — Reconocimiento y procesamiento**

* Detección de rostros.
* Procesamiento asíncrono.
* Reintentos.
* Estados de procesamiento.

**Fase 6 — Funcionalidades complementarias**

* Notificaciones.
* Configuración.
* Privacidad.
* Búsqueda avanzada.

**Fase 7 — Seguridad y calidad**

* Pruebas.
* Validaciones.
* Rendimiento.
* Optimización.
* Responsividad.
* Accesibilidad.

**Fase 8 — Docker**

* Imágenes.
* Docker Compose.
* Healthchecks.
* Pruebas de instalación limpia.

**Fase 9 — Despliegue y documentación**

* Arquitectura de nube.
* Despliegue.
* Manuales.
* Evidencias.
* Revisión de requisitos.
* Preparación para exposición.

No avanzar a otra fase dejando errores críticos sin resolver.

## 12. REGLAS INNEGOCIABLES

1. No desarrollar una copia literal de Instagram.
2. No utilizar una plantilla genérica como resultado final.
3. No sacrificar funcionalidad por estética.
4. No sacrificar estética por funcionalidad.
5. No inventar integraciones.
6. No simular un backend funcional.
7. No almacenar imágenes en la base de datos relacional.
8. No omitir los requisitos académicos.
9. No sobrescribir configuraciones existentes sin revisarlas.
10. No realizar despliegues costosos sin autorización.
11. No inventar que una prueba pasó.
12. No presentar una fase incompleta como finalizada.
13. No modificar indiscriminadamente módulos que ya estén funcionando.
14. Mantener una arquitectura clara, escalable y profesional.
15. Priorizar calidad, consistencia y estabilidad.

## 13. RESULTADO FINAL ESPERADO

Quiero que LUMENZA sea una plataforma que, al abrirla, parezca un producto digital real y no una tarea académica tradicional.
Debe combinar:

* Diseño visual extraordinario.
* Navegación intuitiva.
* Funcionalidades sociales completas.
* Procesamiento real de fotografías.
* Almacenamiento en la nube.
* Seguridad.
* Arquitectura profesional.
* Docker.
* Preparación para Kubernetes y Azure.
* Documentación académica detallada.

La aplicación debe tener identidad propia, interfaces memorables y una experiencia coherente en todas sus pantallas.
Su calidad debe poder defenderse tanto desde el diseño como desde la ingeniería de software.

## 14. PRIMERA INSTRUCCIÓN

Comienza exclusivamente con la Fase 0.
Entrégame:

1. Análisis de los requisitos funcionales y no funcionales.
2. Matriz de cumplimiento del proyecto académico.
3. Propuesta de arquitectura completa.
4. Estructura de carpetas.
5. Modelo de datos preliminar.
6. Mapa de navegación.
7. Definición completa del sistema de diseño.
8. Descripción detallada de todas las pantallas.
9. Estrategia de almacenamiento y procesamiento de imágenes.
10. Plan de desarrollo por fases, con criterios de aceptación.

Después de completar ese análisis, comienza la implementación de los fundamentos según el entorno de trabajo disponible.
No generes miles de líneas de código sin primero establecer una estructura coherente.
La prioridad es desarrollar LUMENZA correctamente desde sus cimientos.
