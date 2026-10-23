#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
cluster="${KIND_CLUSTER:-rolling-lab}"
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
kubectl apply -f scripts/local-load/k8s/job.yaml
kubectl -n next-agent-load wait --for=condition=complete job/agent-load --timeout=300s || {
  kubectl -n next-agent-load logs job/agent-load --all-containers=true
  exit 1
}
kubectl -n next-agent-load logs job/agent-load --all-containers=true
