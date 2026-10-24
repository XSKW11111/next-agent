#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
cluster="${KIND_CLUSTER:-rolling-lab}"
run_id="$(date -u +%Y%m%dT%H%M%SZ)-$$"
run_dir="scripts/local-load/.data/runs/${run_id}"
mkdir -p "$run_dir"

capture_artifacts() {
  local status=$?
  trap - EXIT
  kubectl -n next-agent-load get all -o yaml >"$run_dir/resources.yaml" 2>&1 || true
  kubectl -n next-agent-load get events --sort-by=.metadata.creationTimestamp -o yaml >"$run_dir/events.yaml" 2>&1 || true
  kubectl -n next-agent-load logs job/agent-load --all-containers=true --tail=-1 >"$run_dir/load.jsonl" 2>&1 || true
  kubectl -n next-agent-load logs -l app=agent --all-containers=true --tail=-1 --max-log-requests=10 >"$run_dir/agent.jsonl" 2>&1 || true
  kubectl -n next-agent-load logs deployment/sqlite --all-containers=true --tail=-1 >"$run_dir/sqlite.log" 2>&1 || true
  kubectl -n next-agent-load logs deployment/redis --all-containers=true --tail=-1 >"$run_dir/redis.log" 2>&1 || true
  if [[ -s "$run_dir/load.jsonl" && -s "$run_dir/agent.jsonl" ]]; then
    node scripts/local-load/validate-traces.mjs "$run_dir" >"$run_dir/reconciliation.json" 2>&1 || status=1
  elif [[ "$status" -eq 0 ]]; then
    printf '{"event":"local_load.reconciliation","valid":false,"reason":"missing load or agent logs"}\n' >"$run_dir/reconciliation.json"
    status=1
  fi
  printf 'Load artifacts: %s\n' "$(cd "$run_dir" && pwd)"
  exit "$status"
}
trap capture_artifacts EXIT

if [[ "$(kubectl config current-context)" != "kind-${cluster}" ]]; then
  echo "Current Kubernetes context must be kind-${cluster}." >&2
  exit 1
fi

./node_modules/.bin/esbuild scripts/local-load/agent-server.ts scripts/local-load/load.ts --bundle --platform=node --format=esm --target=node22 --outdir=scripts/local-load/.data/bundle
docker build --provenance=false --sbom=false -f scripts/local-load/Dockerfile.sqlite -t next-agent-load-sqlite:local .
docker build --provenance=false --sbom=false -f scripts/local-load/Dockerfile.runner -t next-agent-load-runner:local .
docker build --provenance=false --sbom=false -f scripts/local-load/Dockerfile.redis -t next-agent-load-redis:local .
kind load docker-image next-agent-load-sqlite:local next-agent-load-runner:local next-agent-load-redis:local --name "$cluster"
kubectl apply -f scripts/local-load/k8s/namespace.yaml
kubectl apply -f scripts/local-load/k8s/services.yaml
kubectl -n next-agent-load rollout status deployment/sqlite --timeout=120s
kubectl -n next-agent-load rollout status deployment/redis --timeout=120s
kubectl -n next-agent-load rollout restart deployment/agent
kubectl -n next-agent-load rollout status deployment/agent --timeout=120s
kubectl -n next-agent-load delete job agent-load --ignore-not-found
kubectl -n next-agent-load rollout restart deployment/sqlite
kubectl -n next-agent-load rollout status deployment/sqlite --timeout=120s
kubectl -n next-agent-load rollout restart deployment/redis
kubectl -n next-agent-load rollout status deployment/redis --timeout=120s
kubectl apply -f scripts/local-load/k8s/job.yaml
kubectl -n next-agent-load wait --for=condition=complete job/agent-load --timeout=300s
kubectl -n next-agent-load logs job/agent-load --all-containers=true
