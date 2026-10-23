# Run local agent load in kind

Run `bash scripts/local-load/run-kind.sh` from this repository with Docker, kind, and `kubectl` available. The command requires the `kind-rolling-lab` context by default. Set `KIND_CLUSTER` to another kind cluster name if needed. The script builds two local images, loads them with `redis:7.4.2-alpine`, and creates resources only in `next-agent-load`.

The Job sends 1,000 HTTP requests with 64 workers by default to an agent Service with two replicas. Edit `LOAD_TURNS` and `LOAD_CONCURRENCY` in `k8s/job.yaml` to change the workload. Its JSON log reports completed turns, errors, p50 and p95 turn latency, throughput, and SQLite row counts. The Job exits with failure if any turn fails or the stored session and message counts differ from the requested turns. Each run resets the disposable SQLite pod before starting the Job.

Each agent replica calls the repository's `runSupportTurn` LangGraph with a scripted model that performs one `lookup_order` tool call. The SQLite HTTP service stores the session streak and the resulting customer and assistant message pair. Redis holds the immutable order fixture for ten minutes. The workload checks the returned order answer and reads the Redis value on every turn. It does not exercise the hosted Next.js API, Supabase, external model latency, or multi-turn session contention. SQLite has one writer, so higher concurrency can expose its write throughput limit. Reported latency includes the graph, local service calls, and message persistence.

SQLite uses an `emptyDir` volume. Deleting the SQLite pod or namespace loses its data. Redis persistence is disabled. These services are for disposable local tests. Remove everything with `kubectl delete namespace next-agent-load`. Docker images and the cluster's unrelated namespaces remain untouched.

The detailed design, boundaries, and one observed 1,000-request report are in `docs/local-k8s-load-design.md`. The script bundles the checked out dependencies with the local `esbuild` binary before building images, so install dependencies on the host first.
