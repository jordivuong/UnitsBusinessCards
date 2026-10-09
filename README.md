# UnitsBusinessCards

Webapp de génération de cartes de visite **PDF/X-3 CMJN** pour l'impression offset (h2impression).
Les clients se connectent, envoient un **CSV** (une ligne par carte) et un logo facultatif, **visualisent**
chaque carte (aperçu rastérisé depuis le PDF final), puis téléchargent les PDF prêts pour l'imprimeur
(un PDF par carte, regroupés dans un ZIP).

Spécification complète : [`docs/SPEC.md`](docs/SPEC.md).

## Chaîne de génération

1. **A** : PDFKit produit un PDF vectoriel en DeviceCMYK pur (boxes Media/Trim/Bleed, traits de coupe optionnels, texte réduit jusqu'au corps minimum, contrôle de la zone de sécurité de 3 mm et des glyphes absents).
2. **B** : Ghostscript → PDF/X-3 (OutputIntent avec profil ICC, polices vectorisées, PDF 1.3).
3. **C** : contrôles automatiques (`pdfinfo`, `pdffonts`, `pdfimages`, transparence, couleurs du PDF final = couleurs de la palette). En cas d'échec, la carte est refusée avec un message en français.

Le logo (PNG/JPEG) est converti en CMJN via ImageMagick/lcms2 (intention relative + compensation du point noir) ; les transparences sont aplaties sur la couleur de fond de l'emplacement. Moins de 150 ppi : refusé ; moins de 300 ppi : avertissement.

## Installation (Docker, recommandé)

```bash
# 1. Placer le profil ICC (voir icc/README.md) : icc/ISOcoated_v2_300_eci.icc
cp .env.example .env   # DOMAIN=cartes.units-demo.com
docker compose up -d --build

# 2. Créer un compte client
docker compose exec cartes node server/cli.js add-user client@exemple.fr 'un-mot-de-passe-long' --client demo
```

Caddy fournit le HTTPS automatiquement : copier `.env.example` en `.env` et y mettre le domaine. Procédure complète pour le VPS : [`docs/DEPLOIEMENT.md`](docs/DEPLOIEMENT.md).
Les comptes et le secret de session sont dans le volume `/data`. Aucun PDF ni donnée saisie n'est conservé :
les envois sont supprimés après 30 minutes (ou au redémarrage).

## Développement local

Prérequis : Node 22, `ghostscript` (≥ 10), `imagemagick`, `poppler-utils`.

```bash
npm ci
ALLOW_TEST_PROFILE=1 DATA_DIR=./data node server/cli.js add-user moi@exemple.fr 'mot-de-passe-long' --client demo
ALLOW_TEST_PROFILE=1 DATA_DIR=./data npm start     # http://localhost:3000
npm test
```

`ALLOW_TEST_PROFILE=1` remplace le profil ECI par un profil générique : **fichiers non imprimables**.

## Clients et modèles

Un dossier par client dans `clients/<slug>/` (modèles, polices) ; chaque compte est rattaché à un client et ne voit que ses modèles.
Les modèles sont **générés depuis Figma** : procédure, conventions de nommage et liste de vérification dans [`docs/FIGMA.md`](docs/FIGMA.md).
Les colonnes du CSV sont les champs modifiables du modèle (en-têtes insensibles à la casse et aux accents ; séparateur `,` `;` ou tabulation).
Le modèle est validé à l'import et au démarrage (palette ≤ 300 % d'encre, polices présentes, logo dans la zone de sécurité…).

## Points à valider avec l'imprimeur

- Format fini (85 × 55 mm supposé), grammage, profil du produit retenu ;
- PDF avec traits de coupe (103 × 73 mm) ou sans (91 × 61 mm) ;
- **Commander un BAT** avec un PDF généré avec le vrai profil ICC et le faire valider par leurs graphistes.

## Licences

Ghostscript (AGPL) est utilisé en sous-processus non modifié. Polices Inter : SIL OFL 1.1. Profils ICC ECI : voir leur licence.
