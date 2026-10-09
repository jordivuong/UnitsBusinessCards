# Déploiement sur le VPS OVH (Ubuntu)

Cible : VPS `vps-0e457e13.vps.ovh.net`, IPv4 `213.32.65.185`, domaine `cards.units.design`.

## 1. DNS (une fois)

Dans la zone DNS OVH de `units.design`, ajouter :

| Type | Sous-domaine | Cible |
|---|---|---|
| A | `cards` | `213.32.65.185` |
| AAAA (facultatif) | `cards` | `2001:41d0:305:2100::1:76b6` |

Vérifier : `dig +short cards.units.design` renvoie l'adresse du VPS. Caddy ne peut obtenir le certificat HTTPS qu'une fois le DNS propagé.

## 2. Préparer le serveur (une fois)

```bash
ssh ubuntu@213.32.65.185        # utilisateur indiqué dans le mail OVH (ubuntu ou root)
sudo apt update && sudo apt -y upgrade
sudo apt -y install docker.io docker-compose-v2 git ufw
sudo usermod -aG docker "$USER"  # puis se déconnecter / reconnecter
sudo ufw allow OpenSSH && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw enable
```

Si `docker-compose-v2` est introuvable sur cette version d'Ubuntu, installer Docker depuis le dépôt officiel :
<https://docs.docker.com/engine/install/ubuntu/>. La commande devient `docker compose`.

## 3. Installer l'application

```bash
git clone https://github.com/jordivuong/UnitsBusinessCards.git
cd UnitsBusinessCards
git checkout claude/awesome-clarke-inzce1      # ou main une fois fusionné
cp .env.example .env                           # vérifier DOMAIN
```

**Profil ICC** (obligatoire, voir `icc/README.md`) : télécharger `ISOcoated_v2_300_eci.icc` sur eci.org, puis depuis votre poste :

```bash
scp ISOcoated_v2_300_eci.icc ubuntu@213.32.65.185:UnitsBusinessCards/icc/
```

Démarrer :

```bash
docker compose up -d --build
docker compose logs -f cartes       # doit afficher « UnitsBusinessCards sur http://localhost:3000 », sans avertissement de profil de TEST
```

## 4. Comptes clients

```bash
docker compose exec cartes node server/cli.js add-user client@exemple.fr 'un-mot-de-passe-long-10-car-min' --client demo
```

Relancer la même commande avec le même e-mail change le mot de passe.

## 5. Mise à jour

Nouveau client ou nouveau modèle (dossier `clients/`) : `git pull && docker compose restart cartes` suffit (voir `docs/FIGMA.md`).
Code de l'application :

```bash
cd UnitsBusinessCards && git pull && docker compose up -d --build
```

Les comptes (volume `cartes-data`) et les certificats (volume `caddy-data`) sont conservés.

## 6. Vérifications après installation

- `https://cards.units.design` s'ouvre en HTTPS, sans bandeau « Profil d'impression de TEST » après génération ;
- générer une carte avec le CSV d'exemple, puis commander un **BAT** chez l'imprimeur avec ce PDF.

## Sauvegarde

Seul le volume `cartes-data` contient des données : comptes, modèles/polices de la page Admin (`clients/`) et cartes enregistrées (`cards/`). Aucun PDF n'est conservé. À sauvegarder.
`docker run --rm -v unitsbusinesscards_cartes-data:/d -v "$PWD":/b alpine tar czf /b/cartes-data.tgz -C /d .`
