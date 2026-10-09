#!/usr/bin/env bash
# Branche UnitsBusinessCards sur un VPS où un Caddy existant (appli UTT) occupe déjà 80/443.
# - n'arrête, ne recrée ni ne reconfigure rien d'UTT ; ajoute seulement un bloc au Caddyfile (après sauvegarde)
# - valide le Caddyfile avant rechargement, et le restaure en cas d'échec
# Usage (en root sur le VPS) :  bash install-vps.sh            (idempotent : on peut le relancer)
set -euo pipefail

BRANCH="${BRANCH:-claude/awesome-clarke-inzce1}"
REPO="${REPO:-https://github.com/jordivuong/UnitsBusinessCards.git}"
DIR="${DIR:-/opt/unitsbusinesscards}"
UTT_DIR="${UTT_DIR:-/opt/timetracking}"
CADDY_CT="${CADDY_CT:-timetracking-caddy-1}"
CADDY_NETWORK="${CADDY_NETWORK:-timetracking_default}"
DOMAIN="${DOMAIN:-cards.units.design}"
CF="$UTT_DIR/Caddyfile"
COMPOSE=(docker compose -f docker-compose.shared-caddy.yml)

say() { printf '\n== %s\n' "$*"; }

say "Contrôles préalables"
docker inspect "$CADDY_CT" >/dev/null || { echo "Conteneur Caddy introuvable : $CADDY_CT"; exit 1; }
docker network inspect "$CADDY_NETWORK" >/dev/null || { echo "Réseau introuvable : $CADDY_NETWORK"; exit 1; }
[ -f "$CF" ] || { echo "Caddyfile introuvable : $CF"; exit 1; }
df -h / | tail -1

say "Code"
if [ -d "$DIR/.git" ]; then git -C "$DIR" fetch origin "$BRANCH" && git -C "$DIR" checkout "$BRANCH" && git -C "$DIR" pull --ff-only origin "$BRANCH"
else git clone -b "$BRANCH" "$REPO" "$DIR"; fi
cd "$DIR"

say "Profil ICC"
if [ -f icc/ISOcoated_v2_300_eci.icc ]; then export ALLOW_TEST_PROFILE=0; echo "profil ECI présent : mode production"
else export ALLOW_TEST_PROFILE=1; echo "ATTENTION : profil ECI absent -> mode TEST (PDF non imprimables). Déposez icc/ISOcoated_v2_300_eci.icc puis relancez."; fi

say "Application (seule, sur le réseau du Caddy existant)"
export CADDY_NETWORK
"${COMPOSE[@]}" up -d --build
sleep 5
"${COMPOSE[@]}" ps
"${COMPOSE[@]}" logs --tail 15 cartes

say "Caddyfile"
if grep -q "^$DOMAIN" "$CF"; then echo "Bloc $DOMAIN déjà présent : rien à ajouter."
else
  BAK="$CF.bak-$(date +%F-%H%M%S)"; cp -p "$CF" "$BAK"; echo "Sauvegarde : $BAK"
  # ajout en fin de fichier (même inode : le fichier est monté dans le conteneur)
  cat >> "$CF" <<EOF

$DOMAIN {
	encode gzip
	reverse_proxy cartes:3000
}
EOF
  if docker exec "$CADDY_CT" caddy validate --config /etc/caddy/Caddyfile \
     && docker exec "$CADDY_CT" caddy reload --config /etc/caddy/Caddyfile; then echo "Caddy rechargé."
  else
    echo "ÉCHEC : restauration du Caddyfile d'origine (UTT inchangé)."
    cat "$BAK" > "$CF"; docker exec "$CADDY_CT" caddy reload --config /etc/caddy/Caddyfile || true; exit 1
  fi
fi

say "Vérifications"
docker exec "$CADDY_CT" wget -qO- --spider "http://cartes:3000/api/me" 2>&1 | head -2 || true
echo "UTT : $(docker ps --filter name=timetracking --format '{{.Names}} {{.Status}}' | tr '\n' ';')"
echo "Ouvrir : https://$DOMAIN   (certificat obtenu au premier accès)"
echo "Compte : cd $DIR && ${COMPOSE[*]} exec cartes node server/cli.js add-user EMAIL 'MOT-DE-PASSE-LONG' --client demo"
