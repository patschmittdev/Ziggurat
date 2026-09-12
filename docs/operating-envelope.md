# Operating envelope and local recovery

The initial target is a single-operator vault with up to 1,000 Gold pages,
5,000 Bronze records, and 1,000 staged proposals. The representative fixture has
99,000,000 canonical content bytes, with approximately 19 KiB Bronze records and
4 KiB knowledge bodies. Counts alone do not describe a workload.

Targets are p95 verified search and citation read below one second each,
Ziggurat RSS below 1 GiB, and the combined generated indexes below 512 MiB.
These are evaluation gates, not universal guarantees for every corpus or machine.
The model server is not included in the retrieval process's memory budget.

## Reproducible measurements

```powershell
npm run eval:envelope -- --output <new-report-directory> --sizes 100,500,1000 --samples 10
```

The opt-in harness creates real synthetic files and disposable test-only signatures,
builds all profiles, and measures actual `ContextAccess` startup, search, and
citation reads. Every search and read includes live integrity and authorization
verification. Per-sample timings, p50/p95/p99, index bytes, disk usage, and process
memory observations are retained. It never uses a private vault or a model.

`--keep` retains the generated fixture vaults for diagnosis; otherwise only the
new test vaults are removed. `--sizes` is capped at 2,000 pages, so a deliberate
out-of-envelope stress point is possible without an unbounded allocation.
The report reserves one combined index set of additional publication headroom.

Startup is a new access instance in the same process, not a claim of a cold OS
disk cache. A separate measurement runs an actual new CLI process and includes its
startup plus verified query latency; it does not sample that child's RSS.
Diagnostic component timings are independent samples, not an exact additive
profile. Process memory includes preparation and prior points, and the native
process RSS high-water mark captures short spikes.

## Baseline

Measured on Windows, Node.js 24.16.0, an i7-12700KF, and approximately 32 GiB RAM:

| Workload | Search p95 | Citation read p95 | Result |
| --- | --- | --- | --- |
| 100 Gold / 500 Bronze / 100 Silver | 538 ms | 553 ms | Latency target met, three samples |
| 1,000 Gold / 5,000 Bronze / 1,000 Silver | 5,123 ms | 4,968 ms | Latency target failed, five samples |

The large baseline also exceeded the RSS target at approximately 1.45 GiB.
Its generated indexes occupied 124,591,673 bytes. A diagnostic sample attributed
approximately 4,859 ms to live-corpus verification, compared with 17 ms for loading
the Gold index and 42 ms for rebuilding BM25. This justified investigating repeated
reads and per-request work rather than adding vectors or a distributed store.

Subsequent measurements must be reported separately, not substituted into this
baseline. No fixed-TTL authorization cache is approved.

## Measured request-local implementation

The final implementation shares verified Bronze bytes only within one request,
bounds source/proposal/receipt work, avoids enumerating unrelated Bronze for Gold,
and loads one configuration view per request. It still validates every staged
proposal and every cited source, and rechecks receipts and time-based eligibility.
No cross-request cache, index-generation shortcut, or relaxed authorization rule
was introduced.

Fresh-process measurements with 20 search/read samples per point:

| Workload | Search p95 | Citation read p95 | Result |
| --- | --- | --- | --- |
| 100 Gold / 500 Bronze / 100 Silver | 92 ms | 87 ms | Targets met |
| 500 Gold / 2,500 Bronze / 500 Silver | 387 ms | 395 ms | Targets met |
| 1,000 Gold / 5,000 Bronze / 1,000 Silver, default Node heap | 717 ms | 721 ms | Latency met; RSS failed at approximately 1.32 GiB |
| Same 1,000-page workload, explicit 512 MiB Node old-space budget | 731 ms | 723 ms | Latency, RSS, and index targets met |

For the bounded-heap run, peak process RSS was 806,932,480 bytes (approximately
770 MiB); combined indexes occupied 125,484,673 bytes (approximately 120 MiB).
Build time was 3.078 seconds. A new CLI process plus its verified query took
1.796 seconds, which is reported separately from the steady-session latency gate.
The source implementation fingerprint was
`53a7258d663fe286f1a552f980dcf52b1ad463955775defaf68a4321061005fa`.
The harness rejects a run if compiled source changes between its initial
fingerprint and a measured point.

The memory target therefore depends on an **explicit operating profile**, not an
unstated default change:

```powershell
node --max-old-space-size=512 dist\test\manual\operating-envelope.js --output <new-report-directory> --sizes 1000 --samples 20
node --max-old-space-size=512 dist\src\cli\main.js build --root <vault>
node --max-old-space-size=512 dist\src\cli\main.js mcp --root <vault>
```

`--max-old-space-size` limits V8 old-space, not total process RSS. The measured
RSS result is not a universal guarantee, and an oversized corpus can still run
out of memory. The runtime argument is recorded in reports and propagated to the
measured CLI child. There is no forced-GC benchmark hook and no persistent system
configuration change. The default uncapped-memory failure remains part of the
record.

An explicitly out-of-envelope stress case with 2,000 Gold pages, 10,000 Bronze
records, 2,000 proposals, and 198 MB canonical content exhausted the 512 MiB
old-space budget during build and exited with code 134. It is not a passing
capacity result. Rebuilding that disposable vault with a 1,024 MiB old-space
budget succeeded, and a subsequent verified query succeeded. Before/after
digests of all 14,005 files outside `.ziggurat` confirmed unchanged Bronze,
knowledge, receipt, and configuration bytes. That digest did not cover Silver.
The disposable stress vault was removed after recording recovery evidence.

## Revocation and concurrency contract

Key removal, receipt changes, source/page mutations, contradictions, and time-based
expiry must be visible to the next request's verification. Previously issued
citation IDs do not bypass verification. Do not return cached authorized content
for a grace period after revocation.

Individual index files are published atomically. The three-file build is not a
single filesystem transaction. During changes or overlapping commands, readers
must see a complete verifiable index or refuse stale/unverifiable state, not
serve an unchecked mixture. Arbitrary external edits during a request are not
claimed to be an atomic snapshot of the whole filesystem.

## Failure and recovery

| Failure | Required behavior | Operator action |
| --- | --- | --- |
| Serialization, write, or sync fails | Preserve the previous index; close and remove the writer's own temporary file | Check the reported phase, disk space, permissions, and rebuild |
| Windows publication encounters transient sharing locks | Retry the atomic rename within a bounded 155 ms wait budget, then fail explicitly | Stop persistent overlapping writers or readers that deny sharing, then rebuild |
| Process dies before publication | Old index remains intact; an incomplete temporary file may remain | Rebuild; remove only specifically identified remnants after confirming no writer owns them |
| A build publishes only part of the three-file set | Live verification refuses any stale profile | Rerun the complete build after stabilizing corpus state |
| Corpus or trust changes after citation issuance | Search and citation read must reverify and refuse stale authority | Correct/re-authorize source artifacts as appropriate and rebuild |

Temporary remnants are not proposals, approval records, or authoritative indexes.
Recovery must not bulk-delete staged proposals or hide unresolved contradictions.
The automated tests use real files, concurrent CLI processes, and a deliberately
terminated child writer, not filesystem mocks.

## Actual disk-full test

`npm run test:disk-full` requires a separately provisioned disposable filesystem
between 1 and 64 MiB. It intentionally fills only that filesystem, requires
`--confirm-disposable`, rejects unexpected existing files, and requires a root
marker named `.ziggurat-disposable-volume` containing exactly:

```text
DISPOSABLE ZIGGURAT TEST VOLUME
```

Then run:

```powershell
npm run test:disk-full -- --volume <disposable-volume-root> --confirm-disposable
```

The test requires actual `ENOSPC`, verifies the previous index survived, releases
its own fill file, and verifies a new publication succeeds. Filling is independently
capped at 64 MiB even if the volume changes after preflight. An ordinary host disk
is refused before filling it.

### Verified Linux container run

With Docker running Linux containers, use the same real-file harness without
provisioning or filling any host volume:

```powershell
npm run test:disk-full:container
```

The wrapper pins the Node.js 24.16.0 Debian bookworm-slim image by digest:
`sha256:2c87ef9bd3c6a3bd4b472b4bec2ce9d16354b0c574f736c476489d09f560a203`.
Docker may download that public image on first use. The test container has no
network, a read-only root, no added capabilities, a non-root user, a 256 MiB
memory cap, and a separate 48 MiB tmpfs. Only compiled code, installed
dependencies, and package metadata are mounted, all read-only. The marker is
created inside that new tmpfs; the host checkout is never a fill target.
Docker removes the container and its tmpfs after exit. Missing Docker or a
test failure fails the command rather than returning a passing skip.

On 2026-09-12 the run passed with Docker Engine 29.5.2, Linux kernel
`6.6.114.1-microsoft-standard-WSL2`, Node.js 24.16.0, and an initially empty
tmpfs reporting 12,288 blocks of 4,096 bytes:

```json
{"actual_errno":"ENOSPC","previous_index_preserved":true,"recovery":"passed"}
```

Both the filler and attempted replacement returned real `ENOSPC`. The previous
index remained readable and unchanged; removing the filler allowed a replacement
to publish successfully. No filesystem mocking, host-volume filling, or elevated
Windows VHD provisioning was used. The Ubuntu/Node 24 CI job now includes this
command; local success is not evidence that an unmerged workflow ran remotely.

This verifies Linux tmpfs behavior, not native Windows/NTFS disk-full recovery,
physical disk failure, or atomic publication of all three indexes together.
The earlier attempt to provision a 48 MiB Windows VHD was refused by authorization
policy and created no VHD. Native Windows ENOSPC remains unverified.
