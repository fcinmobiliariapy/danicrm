# Security Specification — CRM Político (Firestore Rules TDD)

## 1. Data Invariants
1. **Default-Deny Catch-All**: Any path not explicitly matched is denied (`allow read, write: if false`).
2. **Email Verification Mandate**: Every authenticated write requires `request.auth != null && request.auth.token.email_verified == true`.
3. **Path Variable Hardening**: Every single-document operation (`get`, `create`, `update`, `delete`) validates `isValidId(docId)` (`^[a-zA-Z0-9_\-]+$`, max 128 chars).
4. **Bootstrapped Admin & Zero Self-Escalation**: Only `luistreviso@gmail.com` (verified) holds implicit `super_admin`. Non-admin users creating their own `/users/{uid}` profile can ONLY create with `role_slug == 'viewer'` and `active == false`, and CANNOT modify `role_slug`, `active`, or `custom_permissions`.
5. **PII Isolation & Query Enforcement**: Collections containing PII (`users`, `user_invites`, `coordinators`, `youth_members`, `women_members`, `onp_members`) NEVER allow blanket `isSignedIn()` reads. `allow list` checks `isBootstrappedAdmin() || resource.data.ownerUid == request.auth.uid` (no `get()`/`exists()` inside `allow list`).
6. **Relational Integrity**:
   - `districts` must reference an existing `/departments/{department_id}` on create.
   - `seccionales` must reference existing `/departments/{department_id}` and `/districts/{district_id}` on create.
   - `coordinators`, `youth_members`, `women_members` must reference existing `/departments/{department_id}` and `/districts/{district_id}` on create.
   - `vote_projections` must reference an existing `/coordinators/{coordinator_id}`, `/departments/{department_id}`, and `/districts/{district_id}` on create.
7. **Temporal Integrity & Immutable Fields**: `createdAt == request.time` on create; `updatedAt == request.time` on create and update; `ownerUid` and `createdAt` are immutable after creation; `audit_logs` are strictly append-only (no update/delete by non-admin, and even admin cannot mutate existing logs—only create).
8. **Terminal State Locking**: Once `agenda_events.status` is `'realizado'` or `'cancelado'`, non-admin users cannot update the event (admin override `isAdmin()` allowed).

## 2. The "Dirty Dozen" Adversarial Payloads (Expected: PERMISSION_DENIED)
1. **Unauthenticated Write**: `POST /coordinators/c1` with `auth: null` -> Denied (Master Gate).
2. **Unverified Email Write**: `POST /coordinators/c1` with `email_verified: false` -> Denied.
3. **ID Poisoning**: `POST /coordinators/bad$id..1500chars` -> Denied (`isValidId` regex/size failure).
4. **Self-Privilege Escalation**: Non-admin creates `/users/{uid}` with `role_slug: 'super_admin', active: true` -> Denied.
5. **Shadow / Ghost Field Injection**: `POST /coordinators/c1` including extra field `isVerified: true` -> Denied (`hasOnly` check).
6. **Owner Spoofing**: Non-admin creates `/onp_members/o1` with `ownerUid: 'other_user_uid'` -> Denied (`ownerUid == request.auth.uid`).
7. **Client Timestamp Forgery**: `POST /departments/d1` with `createdAt: '2020-01-01T00:00:00Z'` instead of `request.time` -> Denied.
8. **Orphaned Relational Write**: `POST /vote_projections/vp1` referencing non-existent `coordinator_id: 'nonexistent'` -> Denied (`exists()` check).
9. **PII Blanket List Scraping**: Non-admin runs `list /coordinators` without `where('ownerUid', '==', uid)` -> Denied (`allow list` evaluates `resource.data.ownerUid == request.auth.uid`).
10. **PII Cross-User Get**: Non-admin reads `/users/another_uid` -> Denied.
11. **Terminal State Bypass**: Non-admin updates `/agenda_events/ev1` whose `status == 'realizado'` -> Denied.
12. **Audit Log Tampering**: Non-admin updates or deletes `/audit_logs/log1` -> Denied (append-only).
