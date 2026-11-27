# Domain lottery Participant Backend contract

Phase 05A provides read-only participant status. Phase 05B adds the participant draw. Phases 04C and 04E provide Admin revision and recovery.

## Phase 05A eligibility and identity

- The new route requires the existing `protect` middleware and permits `PARTICIPANT` or `ADMIN` roles for the four lottery routes. `protect` verifies the cookie or bearer token and loads the active User from the database. The existing dashboard's broader portal-role policy stays in place.
- Look up registrations by `Registration.user` and either their physical event or a stored child entitlement. The partial unique index on `(event, user)` covers account-linked registrations for a single source event. It cannot resolve overlaps between a direct entry and a Combo Pass entry. Reject multiple distinct eligible keys with `DOMAIN_ENTRY_AMBIGUOUS`. Multiple records resolving to the same eligible key count once.
- Individual identity comes from the eligible `Registration._id`. A team row must reference a Team attached to the same source event, and both the target and source event modes must match the entry type. Team identity comes from `Team._id`. Only the account in `Team.leader` can initiate a draw. Account-linked member rows can see the shared status. Current team registration sets `Registration.user` for the leader only, leaving other member rows unlinked. Unlinked members cannot authenticate through those rows.
- Use the saved `MULTI_EVENT` entitlement and verify the registration's source is a Combo Pass parent. Existing snapshots determine the entitled child IDs, including when a parent's current child list differs. Legacy rows without a snapshot get access to their own source event only. The assignment lookup always uses the target child event with the original registration or team key. A Combo Pass parent cannot be a lottery target.
- Reuse `resolveRegistrationAdmissionEligibility`. Registration and, for a team, Team must be `REGISTERED`. Individual payment comes from Registration. Shared payment comes from Team. The existing policy accepts `VERIFIED` and `NOT_REQUIRED`, including its legacy missing-status fallback. Pending, rejected and unsupported payment states deny access. A cancelled target or source denies eligibility. A completed target can retain eligible status and READ access but cannot authorize a new draw. There is no attendance or check-in requirement.
- Status returns a fixed set of flags, an event ID, entry type and safe reason text. Ineligible users receive no lottery visibility, draw state, or assignment information. Legacy `PUBLIC` grants neither draw nor whole-bank READ permission. The route uses `Cache-Control: no-store`.
- Resolve existing assignments by event, entry type and entry ID. Validate the referenced snapshot in the version 1 or later-version collection and compare the stored copy to that snapshot's selected domain. An older valid assignment stays locked. An invalid reference fails without exposing content. For new draws and whole-bank READ eligibility, active publication requires the exact published version. A reset draft has no active snapshot.

## Entry identity and authorization

- Individual assignment identity is `(event, INDIVIDUAL, Registration._id)`.
- Team assignment identity is `(event, TEAM, Team._id)`. Resolve a participant's Registration and verify that it belongs to the requested event and Team before exposing or creating an assignment. Team leader and members all resolve to this same Team ID.
- Never accept `domain`, `entry`, `entryType`, or a preferred theme from the participant request.
- Keep all reads and writes scoped to the physical event. Combo Pass entitlements authorize eligible child event participation; the parent event is not an assignment event.

## Draw transaction

The existing `DomainAssignment` schema stores `event`, `entryType` (`INDIVIDUAL` or `TEAM`), `entry`, `domain`, `initiatedBy` (the authenticated User ID), `assignedAt`, `poolVersion`, and immutable `contentSnapshot` fields. Its unique index, `uniq_domain_assignment_event_entry`, covers `(event, entryType, entry)` across all pool versions. The active snapshot loader selects the exact event and published version, dispatches to the legacy or versioned collection, and checks the publication timestamp and content hash.

Phase 05B calls `withDomainPoolLock(eventId, operation)`. The coordinator writes the event lock first, supplies the session to the callback, and returns the result after a majority commit. The Phase 05A resolver supplies the authorized entry, leader permission, existing validated assignment, and verified active snapshot when a draw is permitted. Recheck all of these inside the transaction. Non-lottery event, payment and registration mutations do not acquire the domain lock. The Phase 04F replica-set pass remains a prerequisite for deploying lottery writes.

The backend's CORS middleware rejects unknown Origins but allows missing Origin for server-to-server traffic. The draw route requires an explicitly allowlisted Origin when the auth cookie is used, including when a Bearer header is also present. Bearer-only requests can omit Origin. The route requires an empty JSON object, rejects query parameters, and marks responses `no-store`.

1. Resolve and authorize the current participant's registration or team.
2. Look up `(event, entryType, entry)`. Return a valid existing assignment to the authorized entry, including account-linked team members, even after Close, READ, or completion. Ineligible users never receive its contents.
3. For a new assignment, require an eligible individual or team leader, a published event, `domainConfig.enabled === true`, `drawStatus === "OPEN"`, `visibility === "PRIVATE"`, and a valid active snapshot loaded with the same session.
4. Use `crypto.randomInt(0, domains.length)` on the returned snapshot. Validate candidate IDs and content before selecting. An event-only snapshot lookup, a highest-version lookup, or reading `EventDomain` could select an obsolete snapshot or editable drafts.
5. Create one `DomainAssignment` with the chosen domain ID, the exact frozen title/problem/instructions in `contentSnapshot`, the event pool version, and the authorized entry identity.
6. If the unique `(event, entryType, entry)` index rejects a concurrent duplicate, read and return the committed winner. Do not redraw or overwrite it.

The assignment collection intentionally allows many entries to reference the same domain. The unique key prevents separate assignments for one team in one event.

The coordinator may rerun the callback after a known transient abort. Every rerun re-resolves eligibility, any existing assignment, and the active publication before a new selection. An assignment insert that reports a duplicate key aborts without entering the coordinator's retry loop. For that conflict or an unknown commit, the draw service re-resolves authorization, looks up the exact attempted entry with majority read concern, and returns a verified winner as HTTP 200 if present. Reconciliation performs only reads. An unresolved duplicate returns `409 DOMAIN_ASSIGNMENT_CONFLICT`. An unresolved commit returns `503 DOMAIN_COMMIT_UNKNOWN`.

### Postman against an isolated development backend

Set `BASE_URL=http://localhost:5000` and `EVENT_ID` to a disposable event. Use an eligible participant's Bearer token. If using a participant cookie, set `Origin` to a configured frontend origin such as `http://localhost:5173` under the default development configuration.

```http
POST {{BASE_URL}}/api/participant/events/{{EVENT_ID}}/domains/draw
Content-Type: application/json
Authorization: Bearer {{PARTICIPANT_TOKEN}}

{}
```

For a first successful draw, expect HTTP 201 with this shape:

```json
{
  "success": true,
  "message": "Theme assigned and locked.",
  "data": {
    "eventId": "0123456789abcdef01234567",
    "hasAssignment": true,
    "isLocked": true,
    "alreadyAssigned": false,
    "theme": {
      "title": "Smart Agriculture",
      "problemStatement": "Build a crop monitoring prototype.",
      "instructions": "Present a working demo."
    },
    "assignedAt": "2026-11-27T00:00:00.000Z"
  }
}
```

Repeat to expect HTTP 200 with `alreadyAssigned: true`, message `Your entry already has a locked theme.`, and the original theme and timestamp. Repeat after Close to verify retrieval. An unassigned entry after Close gets `409 DOMAIN_LOTTERY_NOT_OPEN`. An unassigned team member gets `403 TEAM_LEADER_REQUIRED`. Use separate eligible entries to check individual and child-event assignment, and verify that different teams can receive the same theme. Use the status route for an advisory check before retrying an unresolved commit. Only run these writes on isolated test records.

## Close ordering

The draw transaction and Admin close operation must use the same event lock. If a draw transaction commits first, that assignment is valid and close follows it. If close commits first, a new draw observes `CLOSED` and is rejected. Existing assignment reads remain available after closure. A close operation must never delete or rewrite assignments.

## READ access

Both Phase 05C read routes require the existing `protect` middleware and permit `PARTICIPANT` or `ADMIN` roles. Entry ownership and eligibility still apply to both roles. They set `Cache-Control: no-store` and accept no caller-supplied entry, team, registration, domain, or pool identifiers.

### `GET /api/participant/events/:eventId/domains/my-theme`

Resolve the participant through the Phase 05A eligibility resolver, then look up the persisted assignment by `(event, entryType, entry)`. The individual key uses `Registration._id`; the team key uses `Team._id`. An authenticated account-linked team member and the leader resolve to the same team assignment. Combo Pass registrations resolve only to the entitled child event. The route does not require an open draw and never draws or writes.

The response serializes only the immutable assignment content snapshot and original `assignedAt`. Before returning it, validate the assignment key and pool version, verify the referenced historical versioned snapshot and its hash, and ensure the assigned domain occurs exactly once with content matching the assignment snapshot. The assignment's pool version may be older than the current active version; a valid older assignment remains retrievable. Missing or inconsistent references return sanitized `409 DOMAIN_ASSIGNMENT_INTEGRITY_FAILED`.

If an eligible entry has no assignment, return HTTP 200 with `hasAssignment: false`, `isLocked: false`, `theme: null`, and `assignedAt: null`. This response contains no draft or frozen-pool content. Ineligible entries follow Phase 05A errors and do not receive assignment details.

### `GET /api/participant/events/:eventId/domains`

Return HTTP 200 only when the participant is eligible, the event is eligible, domains are enabled, visibility is exactly `READABLE`, and `drawStatus` is `CLOSED`. Load the exact active snapshot through `loadActiveSnapshot(event)`, which verifies event, pool version, publication time, and content hash. Serialize only title, statement, and instructions; do not return IDs, hashes, historical pools, assignments, audits, or mutable draft records. Legacy `PUBLIC` remains denied.

Before disclosing the result, re-read the event from the primary with linearizable read concern and a bounded timeout. Compare eligibility, registration mode, READABLE/CLOSED state, pool version, publication time, and pending revision state with the validated snapshot. If reset or another state change has committed before this final check, deny the request; if the authoritative read fails, return sanitized `503 DOMAIN_BANK_CHECK_UNAVAILABLE`. A change committed after this final check is concurrent with the GET; the response is authorized at that check's linearization point. A reset revokes access for later checks, but information already disclosed cannot be recalled. The route never acquires a write lock or changes assignments.

Example no-assignment response:

```json
{"success":true,"data":{"eventId":"0123456789abcdef01234567","hasAssignment":false,"isLocked":false,"theme":null,"assignedAt":null}}
```

Example READABLE response:

```json
{"success":true,"data":{"eventId":"0123456789abcdef01234567","visibility":"READABLE","domains":[{"title":"Smart Agriculture","problemStatement":"Build a crop monitoring prototype.","instructions":"Present a working demo."}],"total":1}}
```

### Isolated Postman checks

Set `BASE_URL=http://localhost:5000`, `EVENT_ID` to a disposable event, and authenticate as an eligible participant. A successful no-assignment request returns HTTP 200 and the null-theme shape above. An assigned request returns HTTP 200 with `hasAssignment: true`, `isLocked: true`, the original theme and timestamp; repeat the request after closing the draw to confirm they remain unchanged. An ineligible or ambiguous entry receives a sanitized 4xx error.

For the full-bank route, check a private draft, private open/frozen pool, legacy `PUBLIC`, reset draft, or readable/open state: each is denied with HTTP 403 `DOMAIN_BANK_UNAVAILABLE` and no `data`. After Admin closes the draw and enables READ, an eligible participant receives the complete active frozen list and matching `total`. A read racing with a committed reset is denied; an authoritative read failure returns HTTP 503. Use disposable local records only; these GET requests do not write assignments.

## Admin pool revision

- The existing `domain_pool_snapshots` collection and its unique event index continue to hold version 1. Versions 2 and later are stored in `domain_pool_snapshot_versions` with a unique `(event, poolVersion)` key. Existing indexes and data require no migration.
- Event `poolVersion` is the last published version. An active snapshot requires `publishedAt` and valid frozen contents for that exact event and version. Revision clears the active publication and draw timestamps and sets `revisionPending`, leaving the counter and snapshots intact. The event-scoped `EventDomain` records are the active draft. The next open creates the next version and updates the event in the same transaction.
- `POST /api/admin/events/:eventId/domains/revise?poolState=frozen:1` uses body `{}` and the existing admin middleware. The endpoint checks every assignment for the event inside the lock, regardless of entry type or version. The Admin UI sends `poolState` for each lifecycle mutation. Opening a revised draft requires `poolState=draft:<last-version>`, so a stale reopen request cannot publish a draft.
- Every assignment writer and lifecycle mutation must use the same event lock. If a draw commits before closure, its assignment blocks revision. Once close or revision commits, a new draw sees the closed state and cannot create an assignment. If reopen or enable-read commits against the frozen version first, revision fails its state check. If revision commits first, those operations fail against the now-inactive pool. CRUD applies only after the active pool is a draft. A transaction with an unknown commit outcome requires a status read before another attempt.

## Audited recovery

Both Phase 04E endpoints require the Admin role and the `coordinationVersion` from a fresh `GET /api/admin/events/:eventId/domains/status`. Send the version as a query parameter and use the JSON body shown below.

| Endpoint under `/api/admin/events/:eventId/domains` | JSON body | Effect |
| --- | --- | --- |
| `POST /reset-to-draft?coordinationVersion=N` | `{"confirmation":"RESET_TO_DRAFT","reason":"Accidental READ activation"}` | A published event with an enabled, closed, valid `PRIVATE` or `READABLE` frozen pool can return to a private draft if it has zero assignments. |
| `POST /clear-draft?coordinationVersion=N` | `{"confirmation":"CLEAR_DOMAINS"}` | Clears the current enabled private draft when unassigned. Accepts an optional reason. |

Reasons are limited to 500 characters. Reset requires a nonblank reason. The response includes updated configuration, active draft and version metadata, the domain count, allowed actions, and the persisted audit record. The application only inserts audit records in `domain_admin_audits`. It records the actor, reason, prior publication and READ metadata, and deletion count in the same transaction. Snapshot collections and their indexes stay unchanged.

Every coordinated write advances the lock version. If another admin creates a draft domain before a clear commits, the stale clear fails and the new draft survives. A create that runs after a clear commits also survives. A reset reviewed before another admin enables READ or reopens the draw must be confirmed against fresh state. The server returns `409 DOMAIN_HAS_ASSIGNMENTS` if it finds any assignment for the event, regardless of type or pool version. A protected pool would require a separately designed reassignment workflow.

## Isolated verification before rollout

The suite only reads `DOMAIN_REVISION_REPLICA_URI`. Leave application `MONGO_URI` and `.env` alone. Before it creates any collections, the suite checks for a direct loopback seed, an initialized single-member primary advertising the same port, session support, and an empty server apart from MongoDB system databases. It creates a uniquely named `domain_revision_test_...` database and prints the actual collection indexes.

Run this from the repository root in PowerShell with Docker Desktop in Linux-container mode. It starts a new container with loopback-only publishing and no mounted application data. It removes the container and disposable data when finished. The same port is used inside the container and on the host so the advertised member passes the suite's isolation check.

```powershell
$container = docker --context desktop-linux run --rm --detach --name vibrant-domain-04f --publish 127.0.0.1:27018:27018 mongo:8.0 --replSet revision-test --bind_ip_all --port 27018
if ($LASTEXITCODE -ne 0 -or -not $container) { throw "Could not start a new disposable MongoDB container" }

function Wait-TestMongo([string]$check) {
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        docker --context desktop-linux exec $container mongosh --quiet --host 127.0.0.1 --port 27018 --eval $check *> $null
        if ($LASTEXITCODE -eq 0) { return }
        Start-Sleep -Seconds 1
    }
    throw "The disposable MongoDB server did not become ready"
}

try {
    Wait-TestMongo "if (!db.adminCommand({ping:1}).ok) quit(1)"
    docker --context desktop-linux exec $container mongosh --quiet --host 127.0.0.1 --port 27018 --eval "rs.initiate({_id:'revision-test',members:[{_id:0,host:'localhost:27018'}]})"
    if ($LASTEXITCODE -ne 0) { throw "Replica-set initialization failed" }
    Wait-TestMongo "if (!db.hello().isWritablePrimary) quit(1)"

    $env:DOMAIN_REVISION_REPLICA_URI = "mongodb://127.0.0.1:27018/?replicaSet=revision-test"
    Push-Location backend
    try {
        node --test tests/domain-revision-replica.test.js
        if ($LASTEXITCODE -ne 0) { throw "Replica-set verification failed" }
    } finally {
        Pop-Location
        Remove-Item Env:DOMAIN_REVISION_REPLICA_URI
    }
} finally {
    docker --context desktop-linux stop $container
}
```

An existing fresh local replica set may be used instead by setting the same variable to its loopback port and replica set name, then running the same command from `backend`. The suite keeps its fixture database for inspection, so use a new disposable server for each run. An unset variable skips the replica suite. See [MongoDB's Docker guide](https://www.mongodb.com/resources/products/compatibilities/deploying-a-mongodb-cluster-with-docker) for the container and replica-set initialization pattern.

For manual staging, run the new backend and Admin Frontend against a dedicated staging database. Verify the unique coordination, versioned snapshot, legacy snapshot and assignment indexes exist and the backend can insert into `domain_admin_audits`. Create a disposable published event, enable Domains, add a theme, open and close the lottery, then enable READ. Under **Administrative Actions**, choose **Reset Lottery to Draft**, type `RESET_TO_DRAFT`, and enter a reason. Verify **Private Draft**, restored editing, and preserved version 1. Clear the draft with `CLEAR_DOMAINS`, add a replacement theme, open the lottery, and verify version 2 is active. Check the unchanged version 1 snapshot and both audit records in staging. Run the replica suite for assignment, rollback, and race coverage.

Complete the staging checks before rollout. Use the Phase 04E backend with the new Admin Frontend and ensure the audit collection is provisioned if automatic collection creation is disabled. Keep all instances serving Admin domain management on the Phase 04E backend before using either recovery action. A backend from before Phase 04C only recognizes the legacy snapshot collection and cannot operate a version 2 or later pool.
