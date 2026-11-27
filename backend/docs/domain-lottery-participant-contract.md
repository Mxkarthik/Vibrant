# Domain lottery Participant Backend contract

This contract is for the later Participant Backend phase. Phases 04C and 04E add Admin revision and recovery.

## Entry identity and authorization

- Individual assignment identity is `(event, INDIVIDUAL, Registration._id)`.
- Team assignment identity is `(event, TEAM, Team._id)`. Resolve a participant's Registration and verify that it belongs to the requested event and Team before exposing or creating an assignment. Team leader and members all resolve to this same Team ID.
- Never accept `domain`, `entry`, `entryType`, or a preferred theme from the participant request.
- Keep all reads and writes scoped to the physical event. Combo Pass entitlements authorize eligible child event participation; the parent event is not an assignment event.

## Draw transaction

The draw operation must call `withDomainPoolLock(eventId, operation)` and use the provided MongoDB session for every read and write in the operation.

1. Resolve and authorize the current participant's registration or team.
2. Look up `(event, entryType, entry)`. If an assignment already exists, return it unchanged, even if the lottery is now closed.
3. For a new assignment only, require `domainConfig.enabled === true`, `drawStatus === "OPEN"`, `visibility === "PRIVATE"`, and an active published snapshot. Load the event and call `loadActiveSnapshot(event, session)` inside the lock.
4. Select randomly on the server from the returned snapshot's `domains`. An event-only snapshot lookup, a highest-version lookup, or reading `EventDomain` could select an obsolete snapshot or editable drafts.
5. Create one `DomainAssignment` with the chosen domain ID, the exact frozen title/problem/instructions in `contentSnapshot`, the event pool version, and the authorized entry identity.
6. If the unique `(event, entryType, entry)` index rejects a concurrent duplicate, read and return the committed winner. Do not redraw or overwrite it.

The assignment collection intentionally allows many entries to reference the same domain. The unique key prevents separate assignments for one team in one event.

## Close ordering

The draw transaction and Admin close operation must use the same event lock. If a draw transaction commits first, that assignment is valid and close follows it. If close commits first, a new draw observes `CLOSED` and is rejected. Existing assignment reads remain available after closure. A close operation must never delete or rewrite assignments.

## READ access

After `visibility === "READABLE"`, a future authenticated event-eligible read endpoint may return the frozen domains from `loadActiveSnapshot(event)`. Recheck visibility and the active version on every request, and serve the response without caching protected contents. A reset revokes access for future requests. Information already disclosed can remain with its recipients. READ access must not return editable `EventDomain` records or change any assignment.

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
