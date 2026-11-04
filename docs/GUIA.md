# Guía de uso · AquaPure

> Esta guía también está dentro de Obsidian: botón **? Guía** del dashboard o comando *AquaPure: Abrir guía de uso*.

1. [Qué es AquaPure](#inicio)
2. [Primeros pasos (10 minutos)](#primeros-pasos)
3. [Conceptos clave](#conceptos)
4. [Flujo de trabajo diario](#flujo)
5. [Editar el tren de tratamiento](#tren)
6. [Pendientes de los entregables](#pendientes)
7. [Reuniones y actas](#reuniones)
8. [Plantillas](#plantillas)
9. [Cómo leer el dashboard](#dashboard)
10. [Clean Flow (XP y niveles)](#gamificacion)
11. [Referencia de propiedades](#propiedades)
12. [Solución de problemas](#problemas)
13. [Comandos](#comandos)

<a id="inicio"></a>
## Qué es AquaPure

AquaPure convierte tu Vault en la **cabina del coordinador** de la ingeniería de una PTAP. Responde todos los días cuatro preguntas:

1. **¿Cómo va cada etapa del tren de tratamiento?** → semáforo del tren.
2. **¿Qué disciplinas tienen que revisar algo porque otro documento cambió?** → revisiones por impacto.
3. **¿Quién está sobrecargado y qué está pendiente?** → carga de trabajo y pendientes.
4. **¿Qué se decidió y qué quedó comprometido en las reuniones?** → registro de reuniones.

Todo sale de tus propias notas. No necesitas escribir YAML: cada cosa se crea con un formulario y el plugin escribe las propiedades por ti.

> [!tip] Regla de oro
> **Crea con formularios, cambia con botones.** Para emitir una revisión o firmar, usa el botón y no edites las propiedades a mano: así el historial, las firmas y los impactos quedan consistentes.

<a id="primeros-pasos"></a>
## Primeros pasos (10 minutos)

1. **Define el tren de tratamiento.** Abre el dashboard → *Editar tren*. Escoge una configuración típica (convencional, filtración directa, FiME, compacta…) y ajústala.
2. **Registra al equipo.** Botón **+ Persona**: nombre, rol, disciplinas y horas por semana. La disciplina decide a quién llegan los impactos.
3. **Crea los entregables principales.** Botón **+ Entregable**. El código se numera solo (`PTAP-PRC-PID-001`). Marca:
   - **Impacta a**: disciplinas que deben revisar cuando cambie.
   - **Depende de**: documentos de los que se alimenta.
   - **Firmas requeridas**: quién debe aprobarlo.
4. **Registra la reunión de arranque.** Botón **+ Reunión**, con acciones y responsables.
5. **Abre el dashboard cada mañana.** Ícono 💧 de la barra lateral o la barra de estado (abajo a la derecha).

Las notas de la carpeta *Demo* son un ejemplo completo: puedes estudiarlas y luego borrarlas.

<a id="conceptos"></a>
## Conceptos clave

| Concepto | Qué es | Dónde se ve |
|---|---|---|
| **Entregable** | Un documento del proyecto: P&ID, PFD, plano, memoria, hoja de datos, especificación… | Matriz, semáforo, carga |
| **Revisión** | Versión emitida: A, B, C… durante el diseño; 0, 1, 2… desde IFC | Ficha del entregable |
| **Estado** | Borrador · En revisión · Aprobado c/ comentarios · IFC · Bloqueo | Colores de la matriz |
| **Impacto** | Lista de disciplinas que deben revisar cuando el entregable cambia | Bandeja de impactos |
| **Dependencia** | "Este documento se alimenta de aquel". Si aquel cambia, este recibe una revisión | Bandeja de impactos |
| **Revisión por impacto** | Tarea automática para una disciplina después de un cambio, con plazo | Bandeja de impactos, carga |
| **Firma** | Aprobación de una persona sobre la revisión vigente. Una nueva revisión borra las firmas | Firmas pendientes |
| **Carga** | Horas activas de una persona frente a su capacidad semanal | Carga de trabajo |

**Ejemplo real:** el P&ID de dosificación pasa de Rev A a Rev B porque cambió la dosis máxima de PAC. AquaPure crea revisiones para **Civil** (volumen del tanque de solución), **Mecánica** (bombas dosificadoras) e **I&C** (lazo proporcional a caudal), y para la **memoria del floculador**, que depende del P&ID. Cada una aparece en la bandeja con su responsable y vence en 5 días.

<a id="flujo"></a>
## Flujo de trabajo diario

### Coordinador
1. Revisa el **semáforo**. Rojo = bloqueo o algo vencido: haz clic en la etapa para ver los documentos.
2. Revisa la **bandeja de impactos**, ordenada por vencimiento. Persigue los vencidos.
3. Revisa la **carga de trabajo**. Si alguien está en *Sobrecarga*, reasigna antes de que se vuelva un cuello de botella.
4. Revisa los **pendientes** agrupados por responsable y llévalos a la reunión de seguimiento.

### Ingeniero de disciplina
1. Abre **Pendientes** y filtra por tu nombre.
2. Atiende tus revisiones por impacto y pulsa **Despejar** al terminar (+60 XP si llegas a tiempo).
3. Cuando emitas tu documento: clic derecho sobre la nota → **AquaPure: emitir nueva revisión**.
4. Si te toca aprobar: panel **Firmas pendientes** → **Firmar**.

<a id="tren"></a>
## Editar el tren de tratamiento

Cada PTAP es distinta, así que el tren se configura por proyecto: **Dashboard → Editar tren** (o el comando *Editar tren de tratamiento*).

- **Configuración típica:** carga un tren base (convencional, filtración directa, FiME, compacta, convencional + lodos) y luego ajústalo.
- **Renombrar:** escribe sobre el nombre.
- **Reordenar:** flechas ↑ ↓. El orden es el sentido del flujo en el semáforo.
- **Agregar:** escribe el nombre y pulsa *+ Agregar* (ej. *Aireación*, *Flotación DAF*, *Ablandamiento*, *Fluoruración*).
- **Quitar:** papelera. Si la etapa tiene entregables, pide confirmación.
- **Términos alternativos:** palabras que permiten detectar la etapa en el título o el código del documento (ej. *lamelas* → Sedimentación).

El **id** de cada etapa (gris, debajo del nombre) es lo que se guarda en la propiedad `stage:` de los entregables. No cambia al renombrar, así que no se pierde ninguna asociación.

El nivel 2 de madurez exige cubrir al menos el 70 % de las etapas, así que la regla se adapta sola al tamaño de tu tren.

<a id="pendientes"></a>
## Pendientes de los entregables

Toda casilla abierta `- [ ]` dentro de un entregable o un acta es un pendiente. AquaPure las reúne en:

- **Dashboard → Pendientes**: los más urgentes, con un botón para ver todos.
- **Vista Pendientes** (comando *Abrir pendientes*): con búsqueda y filtros por disciplina, responsable y vencidas, agrupada por entregable, por responsable o por fecha.

**Cómo escribir un pendiente para que se entienda:**

```markdown
- [ ] Validar cota de la canaleta Parshall [[Ing. Andrés Rojas - Civil]] 📅 2026-11-20
```

- **Responsable:** enlace a la persona en la misma línea. Si no pones ninguno, se hereda el responsable del entregable (aparece marcado así).
- **Fecha:** `📅 AAAA-MM-DD` (compatible con el plugin Tasks). También se aceptan `due:: AAAA-MM-DD` y `@AAAA-MM-DD`.
- **Cerrar:** el círculo a la izquierda marca la casilla en tu nota y añade `✅ fecha`. Solo se modifica esa línea.
- Los pendientes con responsable también suman a su **carga de trabajo**.

<a id="reuniones"></a>
## Reuniones y actas

**+ Reunión** crea un acta con asistentes, disciplinas, entregables tratados, agenda, **decisiones** y **acciones** (con responsable y fecha).

- Abierta desde un entregable (botón *Acta* o clic derecho), el acta lo lleva ya precargado.
- Cada **acción** queda como `- [ ] … [[Responsable]] 📅 fecha`: entra a la carga de esa persona y a Pendientes.
- Todo lo que escribas bajo el encabezado **## Decisiones** se compila.

**Registro de reuniones** (`AquaPure/Registro de reuniones.md`) se actualiza solo y contiene:
1. Acciones abiertas por responsable, con las vencidas marcadas.
2. Registro de decisiones por fecha: la memoria del proyecto.
3. Índice cronológico de actas.

No edites el registro: se regenera. Edita las actas.

<a id="plantillas"></a>
## Plantillas

Las plantillas están en `AquaPure/Plantillas/`: *Persona*, *Disciplina*, *Entregable* y *Reunión*. Los formularios las usan para el **cuerpo** de la nota.

- Edítalas libremente: agrega secciones, tablas de bases de diseño, listas de chequeo de revisión, normas…
- Variables disponibles: `{{title}}`, `{{date}}`, `{{code}}`, `{{discipline}}`, `{{stages}}`, `{{attendees}}`, `{{decisions}}`, `{{actions}}`… (cada plantilla lista las suyas en un comentario al inicio).
- Las **propiedades** (frontmatter) las escribe siempre el formulario, así que una plantilla nunca puede romper el YAML.
- Si borras una plantilla, se usa la integrada. *Crear / restaurar plantillas* repone las que falten sin tocar las tuyas.

<a id="dashboard"></a>
## Cómo leer el dashboard

| Panel | Cómo leerlo |
|---|---|
| **Indicadores** | Entregables, % IFC, impactos abiertos, vencidos, Velocity (días promedio para cerrar un impacto) y XP |
| **Semáforo del tren** | ⚪ sin documentos · 🟠 en ingeniería · 🟢 todo IFC sin impactos (con **SELLO**) · 🔴 bloqueo o vencido. Clic = documentos de la etapa |
| **Matriz** | Disciplinas × estado. Clic en un número = lista con botones *Emitir rev.*, *Firmar* y *Acta* |
| **Revisiones por impacto** | Lo que cada disciplina debe revisar por cambios ajenos. *Despejar* al terminar |
| **Firmas pendientes** | Entregables cuya revisión vigente no tiene todas las firmas |
| **Pendientes** | Casillas abiertas de entregables y actas, las vencidas primero |
| **Reuniones** | Últimas actas, acciones abiertas y % de cierre |
| **Clean Flow** | Nivel de madurez de la PTAP, racha Cero Rework y XP |
| **Carga de trabajo** | Barra = horas / capacidad; la marca roja es el umbral de sobrecarga. Clic = detalle |

<a id="gamificacion"></a>
## Clean Flow (XP y niveles)

| Acción | XP |
|---|---|
| Despejar una revisión por impacto antes de su plazo | +60 |
| Aprobar una memoria de cálculo, hoja de datos o entregable crítico | +80 |
| Cerrar todos los impactos de una revisión **y** tener todas sus firmas | +120 |

**Racha Cero Rework:** suma 1 por cada entregable emitido IFC sin observaciones mayores. Se reinicia si un IFC se vuelve a modificar o se emite con observaciones mayores.

**Niveles de madurez:** 1 Conceptual → 2 Básica consolidada (≥70 % de las etapas cubiertas y ≥30 % aprobado) → 3 Detalle coordinada (≥60 % aprobado, 0 bloqueos) → 4 IFC sin interferencias (≥90 % IFC, 0 impactos) → 5 Puesta en marcha (`water_quality_compliant: true` en el acta de arranque).

Cada premio se otorga una sola vez. El historial se exporta o se reinicia desde los ajustes.

<a id="propiedades"></a>
## Referencia de propiedades

Solo hace falta si prefieres escribir a mano o importar notas existentes.

**Entregable:** `type: deliverable`, `code`, `title`, `doc_type`, `discipline`, `stage: [ids]`, `phase`, `revision`, `status`, `impacts: [disciplinas]`, `depends_on: [[[nota]]]`, `assigned_to`, `due`, `effort_hours`, `critical`, `major_comments`, `required_signatures`, `signatures`, `revision_history`.

**Persona:** `type: stakeholder`, `name`, `role`, `discipline: [..]`, `capacity_hours`.

**Disciplina:** `type: discipline`, `name`, `short`, `code`, `color`, `aliases_discipline`.

**Reunión:** `type: meeting`, `title`, `meeting_type`, `date`, `attendees`, `disciplines`, `related`.

Los estados se reconocen por palabras clave sin importar tildes ni mayúsculas: *revisión / IFR* → En revisión; *aprobado* → Aprobado; *IFC / para construcción* → IFC; *bloqueo / crítico / rechazado* → Bloqueo.

<a id="problemas"></a>
## Solución de problemas

**Mi nota no aparece en el dashboard.** Revisa que tenga `type:` (deliverable, stakeholder, meeting o discipline) y que no esté en una carpeta excluida (Ajustes → Carpetas excluidas). Luego ejecuta *Re-escanear Vault*.

**Un impacto dice "Sin responsable".** No hay ninguna persona registrada con esa disciplina. Crea una con **+ Persona**.

**Cambié la revisión a mano y no se generaron impactos.** Sí se generan si cambia la letra o la categoría del estado. Si solo corregiste el texto (ej. una tilde), no se considera un cambio. Usa *Emitir revisión* para no depender de eso.

**La carga parece alta.** Cada pendiente sin horas cuenta con el valor por defecto (Ajustes → Horas por actividad). Pon `effort_hours` en los entregables.

**Quiero empezar de cero con la gamificación.** Ajustes → Reiniciar gamificación. No toca tus notas.

**¿Qué archivos escribe el plugin?** Solo las notas que creas con los formularios, las casillas que cierras desde Pendientes, las propiedades que cambias con *Emitir revisión* o *Firmar*, y sus propios archivos en la carpeta `AquaPure/`.

<a id="comandos"></a>
## Comandos

Paleta de comandos (Ctrl/Cmd + P) → escribe **AquaPure**:

- Abrir Dashboard del Coordinador PTAP · Abrir pendientes · Abrir guía de uso
- Nuevo miembro del equipo · Nueva disciplina · Nuevo entregable · Registrar reunión
- Emitir nueva revisión de un entregable · Firmar un entregable (usa la nota activa o abre un buscador)
- Editar tren de tratamiento
- Compilar registro de reuniones · Crear / restaurar plantillas
- Re-escanear Vault · Exportar estadísticas Clean Flow · Regenerar expedientes por disciplina

Puedes asignarles atajos en Ajustes → Atajos de teclado.
