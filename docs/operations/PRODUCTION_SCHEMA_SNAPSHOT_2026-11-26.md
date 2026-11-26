# CitaBot — snapshot de esquema de producción (solo lectura)

- **Proyecto:** Supabase `rphyhaoxwvaezulvhcrf`
- **Fecha de observación:** 26 de noviembre de 2026 (UTC)
- **Repositorio inspeccionado:** `servicerca/Citabot-`, rama `main`
- **Propósito:** inventario operativo para reconciliar el esquema vivo con su historial SQL versionado.

> [!CAUTION]
> Este archivo es un **informe de auditoría**, no una migración, no un respaldo restaurable y no un script de reconstrucción. No ejecutar su contenido como SQL. No modificar el historial de `schema_migrations` ni reproducir migraciones antiguas a partir de sus nombres. Toda corrección futura debe ser una migración nueva, revisada y probada en una base desechable.

## 1. Resumen ejecutivo

| Elemento | Observado |
|---|---:|
| Migraciones registradas en Supabase | 89 |
| Archivos SQL en `supabase/migrations/` de Git | 31 |
| Versiones registradas sin archivo SQL fuente en Git | **58** |
| Tablas en el esquema `public` | 22 |
| Tablas con RLS habilitado | 22 |
| Tablas con RLS forzado | 0 |
| Negocios / servicios / profesionales / clientes | 0 / 0 / 0 / 0 |
| Citas / mensajes / suscripciones / pagos | 0 / 0 / 0 / 0 |

La última versión del registro observado es `20261112034422 citabot_five_business_30_day_pilot`. Una migración de piloto fue renombrada en Git para que su prefijo coincida con el registro de Supabase; su SQL no cambió. Ese ajuste **no** resuelve las 58 fuentes históricas ausentes.

## 2. Versiones registradas sin SQL fuente

La comparación se hizo entre `supabase_migrations.schema_migrations` y los prefijos de los nombres de los archivos `.sql` presentes en el árbol Git.

```text
20260911020453 citabot_production_core_v2
20260911024832 citabot_fix_appointments_and_booking
20260911030148 citabot_public_security_hardening
20260911145324 citabot_stabilize_indexes_and_function_permissions
20260912222600 citabot_whatsapp_integration_hardening
20260912222604 citabot_business_integrations_rls
20260912223011 citabot_rls_performance_hardening
20260912223623 move_btree_gist_out_of_public
20260912223718 citabot_whatsapp_message_helpers
20260912223724 citabot_messages_received_status_guard
20260912223728 citabot_whatsapp_operational_indexes
20260912223749 citabot_whatsapp_messages_status_index
20260912223803 citabot_whatsapp_webhook_constraints
20260912225953 citabot_membership_rls_hardening
20260912230001 citabot_profile_onboarding_rls
20260913063045 harden_public_booking_functions_search_path
20260913150931 protect_whatsapp_message_idempotency
20260913172415 citabot_allow_received_message_status
20260913191744 citabot_data_integrity_uniques
20260914045504 noop_webhook_diagnostic_marker
20260914045527 webhook_diagnostic_noop
20260914054556 add_businesses_owner_select_policy
20260914153148 revoke_public_booking_anon_execute
20260914153206 public_booking_edge_function_route
20260914162555 harden_public_booking_functions
20260914162808 secure_public_booking_function_defaults
20260914190938 consolidate_redundant_rls_policies
20260914192438 consolidate_remaining_permissive_rls_policies
20260916000204 allow_public_booking_without_staff
20260917045013 fix_appointment_business_member_rls
20260917050656 citabot_production_hardening_rate_limit_timezone_rls
20260917050812 citabot_rate_limit_explicit_deny_policy
20260917050822 citabot_roles_permissions_hardening
20260917214828 citabot_allow_pending_subscription_status
20260917215709 harden_public_role_table_grants
20260917215740 harden_remaining_public_role_grants
20260918033100 citabot_prevent_unassigned_staff_double_booking
20260925163320 add_business_directory_listing
20260925170344 add_commercial_monetization_layers
20260925223850 add_business_location_coordinates
20260925223911 expose_business_location_public_booking
20260926000638 citabot_harden_membership_public_exposure
20260926000750 citabot_restrict_authenticated_promotion_visibility
20260926000946 citabot_minimize_data_api_table_privileges
20260926001110 citabot_customer_phone_identity_integrity
20260926001138 citabot_atomic_business_onboarding
20260926001201 citabot_lock_business_membership_mutation
20260926001211 citabot_onboarding_session_email
20260926001304 citabot_remove_redundant_slug_index
20260926001322 citabot_fix_customer_phone_conflict_target
20260926001419 citabot_server_controlled_financial_state
20260926001447 citabot_tenant_integrity_and_write_restrictions
20260926010043 citabot_require_public_listing_basics
20260926015557 add_legal_consent_tracking
20260926015606 public_booking_consent_v2
20260926015805 lock_public_booking_internal_function
20260926015814 lock_legal_acceptance_table_access
20260926015842 index_legal_acceptance_links
```

## 3. Tablas públicas observadas

RLS está habilitado en las 22 tablas listadas. `relforcerowsecurity` estaba en `false` para todas.

| Tabla | Columnas | Políticas RLS |
|---|---:|---:|
| appointments | 15 | 4 |
| business_directory | 17 | 1 |
| business_hours | 9 | 1 |
| business_integrations | 8 | 4 |
| business_members | 4 | 3 |
| business_promotions | 11 | 5 |
| businesses | 19 | 3 |
| campaigns | 9 | 1 |
| citabot_pilot_enrollments | 9 | 0 |
| customers | 11 | 1 |
| directory_boost_orders | 14 | 1 |
| legal_acceptances | 9 | 2 |
| messages | 10 | 1 |
| payments | 11 | 1 |
| platform_admins | 3 | 1 |
| platform_revenue | 9 | 1 |
| profiles | 6 | 3 |
| public_booking_rate_limits | 4 | 1 |
| services | 8 | 1 |
| staff | 7 | 1 |
| subscription_change_reconciliation | 14 | 1 |
| subscriptions | 12 | 1 |

### Lectura especial: `citabot_pilot_enrollments`

- RLS habilitado; sin política RLS.
- No hay privilegios de SELECT/INSERT para `anon` ni `authenticated`.
- `service_role` tiene SELECT, pero no INSERT directo.
- La inscripción se realiza mediante RPC de servidor `citabot_enroll_30_day_pilot(p_business_id uuid, p_enrolled_by uuid)`, función `SECURITY DEFINER` cuyo EXECUTE está restringido a `service_role`.

El linter marca “RLS Enabled No Policy” como INFO. En este caso el bloqueo por defecto parece intencional y coincide con el modelo de acceso servidor-únicamente; **no añadir políticas públicas para silenciar el aviso**.

## 4. Funciones sensibles y límites de ejecución

| Función | SECURITY DEFINER | EXECUTE anon | EXECUTE authenticated | EXECUTE service_role |
|---|---:|---:|---:|---:|
| `create_citabot_business_onboarding(text,text,text,text,text)` | Sí | No | Sí | No |
| `citabot_enroll_30_day_pilot(uuid,uuid)` | Sí | No | No | Sí |
| `book_appointment(...)` | Sí | No | No | Sí |
| `book_appointment_v2(..., boolean, boolean)` | Sí | No | No | Sí |
| `book_appointment_v3(..., boolean, boolean, text)` | Sí | No | No | Sí |
| `consume_public_booking_rate_limit(text,integer,integer)` | Sí | No | No | Sí |
| `get_public_booking(text)` | Sí | No | No | Sí |

La función de alta `create_citabot_business_onboarding` tiene `search_path = pg_catalog`, exige `auth.uid()`, valida campos, serializa intentos concurrentes con advisory locks, impide crear negocios/trials adicionales para el mismo propietario y registra el negocio, membresía y prueba de siete días dentro de una operación. Supabase Advisor la marca como SECURITY DEFINER ejecutable por authenticated; revisar con pruebas, pero no revocar sin probar el flujo de alta autenticado.

Las funciones de reserva se encuentran detrás de Edge Functions y su EXECUTE no está concedido a los roles públicos/authenticated. No abrir permisos RPC directos sin verificar la ruta API y las pruebas de aislamiento.

## 5. Integridad y reservas

Se observaron restricciones/índices de exclusión para impedir reservas solapadas:
- mismo profesional;
- reservas sin profesional asignado.

El RPC `book_appointment_v2` recibe consentimiento de privacidad y consentimiento de WhatsApp como booleanos separados, pero el flujo actual exige ambos. La separación de consentimiento de tratamiento de datos frente a comunicaciones comerciales/WhatsApp es una corrección de producto y privacidad pendiente; requiere recuperar primero el historial SQL y validar el flujo de reserva. No modificar la firma ni ejecutar DDL en producción en esta fase.

## 6. Datos reales observados

Conteos consultados en producción:

| Tabla | Filas |
|---|---:|
| businesses | 0 |
| services | 0 |
| staff | 0 |
| customers | 0 |
| appointments | 0 |
| messages | 0 |
| subscriptions | 0 |
| payments | 0 |

Esto confirma que esas tablas todavía no ofrecen evidencia de operación con clientes reales. Las pruebas automatizadas son de CI/entorno desechable; no equivalen a un piloto con negocios y usuarios reales.

## 7. Advisory de Supabase observado

### Seguridad
1. **INFO — RLS enabled no policy:** `citabot_pilot_enrollments`. Justificación: tabla privada, sin grants a clientes, inscripción desde `service_role`.
   - https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy
2. **WARN — SECURITY DEFINER ejecutable por authenticated:** `create_citabot_business_onboarding`. El cuerpo exige sesión y valida entrada; revisar el endpoint y conservar el test de alta/autorización.
   - https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable
3. **WARN — Protección de contraseñas filtradas deshabilitada** en Supabase Auth. Activar desde la configuración Auth del proyecto y verificar con una prueba controlada; no está cambiada por este informe.
   - https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

### Rendimiento
El advisor informó 30 índices sin uso. Las tablas core consultadas están vacías; por tanto, un índice sin uso todavía no prueba que sea innecesario. No eliminar índices de integridad, reservas, idempotencia o aislamiento de tenants sin carga representativa, `EXPLAIN (ANALYZE, BUFFERS)` y revisión de impacto.

## 8. Plan para reconciliar sin dañar producción

1. Conservar este snapshot como evidencia de solo lectura.
2. Buscar las 58 fuentes originales en ramas antiguas, commits, forks, artefactos de CI y respaldos de migraciones.
3. Obtener un dump **schema-only** fiable de producción (`pg_dump --schema-only --no-owner --no-privileges`) en un entorno con acceso a la conexión; comparar tablas, funciones, triggers, constraints, índices, políticas, grants y extensiones.
4. Crear una matriz por objeto: versión que lo introdujo (si se puede probar), definición observada, fuente recuperada, diferencias y confianza.
5. No recrear archivos históricos con SQL inferido y no cambiar `schema_migrations`.
6. Para cambios nuevos, crear migraciones nuevas y forward-only; probar en Postgres desechable y luego preparar una ventana de aplicación, respaldo y rollback antes de producción.

## 9. Lo que este informe no demuestra

- No prueba que todos los flujos de reservas, pagos, WhatsApp o autenticación funcionen con clientes reales.
- No certifica una restauración completa ni incluye datos personales.
- No constituye un respaldo de la base.
- No reemplaza los archivos originales de migración.
- No autoriza cambios DDL, privilegios, RLS, secretos ni cambios de Auth.
