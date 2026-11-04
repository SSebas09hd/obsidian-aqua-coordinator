---
type: deliverable
code: PTAP-PRC-PID-001
title: P&ID Sistema de Dosificación de Coagulante y Floculación
doc_type: P&ID
discipline: Procesos
stage: [mezcla_rapida, floculacion]
phase: Detalle
revision: A
status: Rev A - Revisión Interna
impacts: ["Civil", "Mecánica", "I&C", "Eléctrica"]
depends_on: ["[[PTAP-PRC-PFD-001 Diagrama de Flujo de Proceso]]"]
assigned_to: "[[Ing. Laura Méndez - Líder de Procesos]]"
due: 2026-11-20
effort_hours: 16
critical: false
major_comments: 0
required_signatures: ["[[Ing. Laura Méndez - Líder de Procesos]]", "[[Ing. Andrés Rojas - Civil]]"]
signatures: []
design_basis:
  caudal_diseno_lps: 85
  dosis_pac_mg_l: [15, 35]
  concentracion_solucion_pct: 10
  tr_mezcla_rapida_s: 30
  floculacion_g_s-1: [70, 20]
  floculacion_tr_min: 25
---
# `PTAP-PRC-PID-001` · P&ID Dosificación de Coagulante y Floculación

> [!procesos] Cómo probar el disparador de cambios
> Cambia `revision: A` → `B` y `status:` → `Rev B - Aprobado con Comentarios`. AquaPure generará revisiones por impacto para **Civil** (volumen de tanques de solución y floculadores), **Mecánica** (bombas dosificadoras y agitadores), **I&C** (lazo de dosificación proporcional a caudal) y **Eléctrica** (VFD de bombas), además del documento dependiente si lo hubiera.

## Alcance
- 2 tanques de preparación de solución de PAC al 10 % (servicio/reserva) con agitador.
- 2 bombas dosificadoras de diafragma (1+1), control por señal 4–20 mA desde el caudalímetro de agua cruda `FIT-101`.
- Punto de aplicación en canaleta Parshall (mezcla rápida hidráulica, G ≈ 1000 s⁻¹).
- Floculador hidráulico de flujo horizontal en 3 tramos (G = 70 → 45 → 20 s⁻¹).

## Lazos de control
| Tag | Descripción | Señal | Disciplina |
|---|---|---|---|
| `FIT-101` | Caudal de agua cruda | 4–20 mA / HART | I&C |
| `AIT-102` | Turbidez agua cruda | 4–20 mA | I&C |
| `FIC-103` | Control de dosis proporcional a caudal | PLC → VFD | I&C / Eléctrica |
| `LSL-104` | Nivel bajo tanque de solución | Discreta | Mecánica / I&C |

## Interfaces declaradas
- **Civil:** volumen útil de tanques de solución y losas de equipos; pérdidas de carga en floculador.
- **Mecánica:** capacidad 0,5–12 L/h por bomba; succión inundada; piping PVC SCH80.
- **I&C:** rango de `FIT-101` y lógica de alarma por baja dosis.
- **Eléctrica:** alimentación de VFD y CCM-01.

## Pendientes
- [ ] Confirmar dosis máxima con ensayo de jarras en época de lluvias [[Ing. Laura Méndez - Líder de Procesos]]
- [ ] Validar cota de la canaleta Parshall con el plano hidráulico [[Ing. Andrés Rojas - Civil]]
