#!/usr/bin/env bash
# Pushes datetime tag (%Y%m%d-%H%M) and :latest; bumps mesician.image.tag in k8s/mesician/values.yaml (not :latest).
# SKIP_VALUES_UPDATE=1 to skip sed. VALUES_FILE=/path overrides values path. TAG= overrides datetime tag only.
# Usage: from repo root, ./scripts/build-push-mesician-image.sh
#
# Raspberry Pi / arm64 cluster: build on amd64 with e.g.
#   DOCKER_DEFAULT_PLATFORM=linux/arm64 ./scripts/build-push-mesician-image.sh
# or: EXTRA_BUILDX_ARGS='--platform linux/arm64' ./scripts/build-push-mesician-image.sh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

IMAGE_REPO="${IMAGE_REPO:-ghcr.io/nkosenhleduma/mesician}"
BUILD_TIME="$(date "+%Y%m%d-%H%M")"
TAG="${TAG:-$BUILD_TIME}"
DOCKERFILE="${DOCKERFILE:-Dockerfile}"
VALUES_FILE="${VALUES_FILE:-${ROOT_DIR}/k8s/mesician/values.yaml}"
LATEST_REF="${IMAGE_REPO}:latest"
TAG_REF="${IMAGE_REPO}:${TAG}"

extra_args=()
if [[ -n "${EXTRA_BUILDX_ARGS:-}" ]]; then
  # shellcheck disable=SC2206
  extra_args=(${EXTRA_BUILDX_ARGS})
fi

docker buildx build --progress=plain \
  -f "$DOCKERFILE" \
  -t "${TAG_REF}" \
  -t "${LATEST_REF}" \
  "${extra_args[@]}" \
  --push \
  .

echo "Pushed ${TAG_REF} and ${LATEST_REF}"

if [[ "${SKIP_VALUES_UPDATE:-0}" != "1" ]]; then
  if [[ ! -f "$VALUES_FILE" ]]; then
    echo "warning: VALUES_FILE missing, skip tag bump: ${VALUES_FILE}" >&2
  else
    # Bump only mesician.image.tag: match repo line then next line starting with tag: (avoid db/minio/cloudflared).
    esc_repo="$(printf '%s' "$IMAGE_REPO" | sed 's/[.[\*^$/]/\\&/g')"
    sed -i "/^[[:space:]]*repository:[[:space:]]*${esc_repo}[[:space:]]*\$/{
      n
      s/^[[:space:]]*tag:.*/    tag: ${TAG}/
    }" "${VALUES_FILE}"
    rel="${VALUES_FILE#"$ROOT_DIR"/}"
    echo "Updated mesician.image.tag in ${rel} → ${TAG}"
  fi
else
  echo "Skipped values.yaml (SKIP_VALUES_UPDATE=1)"
fi

echo "Helm pinned: mesician.image.tag=${TAG} in values (also pushed as :latest on registry)"

