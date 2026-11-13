#!/bin/sh
# Raccourci : ./al tool <outil> <json> --run <RUN>
# Les données de la recherche sont dans ma-recherche/ (APPARTHUNT_WORKSPACE pour en utiliser une autre).
DIR="$(cd "$(dirname "$0")" && pwd)"
export APPARTHUNT_WORKSPACE="${APPARTHUNT_WORKSPACE:-$DIR/ma-recherche}"
exec uv run --project "$DIR/agent" agent-locataire "$@"
