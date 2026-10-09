# Process : du design Figma au dossier client

Un client = un dossier `clients/<slug>/` dans ce dépôt :

```
clients/acme/
  client.json            { "name": "ACME SA" }
  fonts/                 polices du client, au format .otf, nommées par leur nom PostScript (Inter-SemiBold.otf)
  templates/carte-v1.json   un fichier par modèle, GÉNÉRÉ depuis Figma (ne pas éditer à la main)
  assets/                réservé (logos fournis par le client, v2)
```

Les comptes sont rattachés à un client : un utilisateur ne voit et ne peut générer que les modèles de son client.

## Vue d'ensemble

| # | Qui | Étape | Outil |
|---|---|---|---|
| 1 | Chef de projet | Recueillir : format, recto/verso, champs, couleurs **CMJN** (ou Pantone converti), polices + licences, profil et fonds perdus validés par l'imprimeur | fiche client |
| 2 | Designer | Dupliquer le [fichier Figma maître](https://www.figma.com/design/InheT65NTefwSoobTAy0o4) (page « Modèle carte » + page « Guide ») et le nommer `Client – Carte vN` | Figma |
| 3 | Designer | Concevoir en respectant les conventions ci-dessous | Figma |
| 4 | Designer | Auto-contrôle : liste de vérification (fin de ce document) | Figma |
| 5 | Intégrateur | Créer le client, déposer les polices | `npm run client:new` |
| 6 | Intégrateur | Importer le modèle depuis Figma | `npm run figma:import` |
| 7 | Intégrateur | Vérifier : PDF/X-3 d'essai + aperçu | `npm run template:check` |
| 8 | Chef de projet | Validation visuelle par le client sur l'aperçu | PNG de `out/` |
| 9 | Intégrateur | Commit sur une branche, relecture, fusion dans `main` | GitHub |
| 10 | Intégrateur | Déploiement, création des comptes du client | VPS (`docs/DEPLOIEMENT.md`) |
| 11 | Chef de projet | **BAT** chez l'imprimeur avec un PDF réel, validation par ses graphistes, puis mise en service | h2impression |

Ne passez à l'étape 11 qu'avec le **vrai profil ICC** sur le serveur (pas le profil de test).

## Conventions Figma

**Unités.** *1 px Figma = 1 mm*, **y compris pour la taille de police** : un cadre de 91 × 61 px représente une carte de 85 × 55 mm avec 3 mm de fonds perdus, et un texte de 11 pt imprimés se règle à **3,881** dans Figma (c'est ce qui rend l'aperçu Figma fidèle à l'échelle). L'import convertit en points, arrondis au quart de point (avertissement si l'écart dépasse 0,06 pt).

| pt | 6 | 6,5 | 7 | 8 | 9 | 10 | 11 | 12 | 14 |
|---|---|---|---|---|---|---|---|---|---|
| Figma | 2,117 | 2,293 | 2,469 | 2,822 | 3,175 | 3,528 | 3,881 | 4,233 | 4,939 |

Les options `min=` et `max=` des noms de calques restent en **pt** (corps) et en nombre de caractères. Interlignage : **Auto**. L'espacement des lettres (Figma, en px = mm) est converti de la même façon.

**Structure.** Une *section* par modèle (son nom est libre), contenant :

- un cadre **`page:recto`** (et éventuellement **`page:verso`**), de taille = format fini + 2 × fonds perdus.
  Options dans le nom : `page:recto bleed=3 profile=iso-coated-v2` (valeurs par défaut : 3 mm, `iso-coated-v2`). Le verso doit avoir la même taille.
- un cadre **`palette`** contenant un rectangle par couleur, nommé **`nom = C/M/J/N`** (valeurs 0–100), par exemple `encre = 0/0/0/100`, `accent = 85/20/0/0`.
  La couleur du rectangle dans Figma sert d'aperçu : choisissez une teinte RVB proche, **le CMJN du nom fait foi**.
  Règles : texte courant en `0/0/0/100` (noir seul) ; grands aplats noirs en noir riche (ex. `60/40/40/100`) ; total d'encre ≤ 300 %.

**Calques** (l'ordre dans Figma = l'ordre d'empilement) :

| Calque Figma | Nom du calque | Résultat |
|---|---|---|
| Rectangle plein | `fond` ou `bloc` ou tout nom libre | aplat ; un fond doit couvrir tout le cadre (fonds perdus compris) |
| Ligne | `filet` | filet ≥ 0,25 pt, horizontal ou vertical |
| Texte modifiable | `champ:nom label="Nom" min=8 max=40 opt` | champ du CSV |
| Texte fixe | `texte` | texte non modifiable |
| Rectangle | `logo bg=fond` | emplacement du logo (cadre), `bg` = couleur de la palette derrière le logo |
| Tout calque commençant par `_` ou `#` | `_note` | ignoré (notes du designer) |

Options des champs : `label="…"` libellé (colonne du CSV), `min=` corps minimum en pt (par défaut 80 % du corps, jamais < 6), `max=` nombre maximal de caractères (60 par défaut), `opt` champ facultatif, `fill=` couleur. **Les noms de champ standard** (`nom`, `titre`, `telephone`, `email`, `site`) acceptent des synonymes dans le CSV ; tout autre nom est accepté tel quel (libellé ou nom).

**Texte** : zone à **largeur fixe** (la largeur définit la largeur maximale ; le texte est réduit jusqu'au corps minimum puis refusé). Police : le nom PostScript doit correspondre à un fichier `fonts/<NomPostScript>.otf` du client (ou du dossier partagé `fonts/`). Alignement gauche, centré ou droite pris en compte.

**Couleurs** : chaque calque prend sa couleur par l'option `fill=<nom de palette>` (ou `stroke=` pour un filet). Sans option, l'import choisit la pastille de palette de même teinte (à 8/255 près) et refuse en cas de doute.

**Interdit** (l'import refuse) : opacité < 100 %, ombres/flous, modes de fusion, dégradés, images dans le modèle, formes vectorielles libres, contours de rectangle, élément de plus de 2 pages. Les textes et le logo doivent rester à ≥ 3 mm du bord de coupe (zone de sécurité) ; les fonds et aplats vont jusqu'au bord des fonds perdus.

## Commandes

```bash
# 5. Nouveau client
npm run client:new -- acme "ACME SA"
cp /chemin/vers/Polices/*.otf clients/acme/fonts/        # vérifier les licences d'incorporation PDF

# 6. Import depuis Figma (jeton personnel Figma : Settings → Security → Personal access tokens, droit « File content: read »)
export FIGMA_TOKEN=figd_xxx      # inutile si un proxy ajoute l'en-tête X-Figma-Token
npm run figma:import -- --client acme --id carte-v1 --name "Carte ACME" \
     --file <clé du fichier> --node <id de la section>
#   clé du fichier et id du nœud : dans l'URL Figma  figma.com/design/<CLÉ>/…?node-id=<ID avec - à la place de :>
#   derrière le proxy d'un environnement cloud : NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=<bundle CA> (le fetch de Node ignore sinon HTTPS_PROXY)
#   hors ligne : --json export.json  (réponse de l'API « GET /v1/files/:key/nodes »)

# 7. Vérification : écrit out/acme-carte-v1/ (PDF/X-3 avec et sans traits de coupe + PNG)
npm run template:check -- acme carte-v1
```

L'import affiche toutes les erreurs d'un coup, avec le nom du calque en cause ; corrigez dans Figma et relancez. Il rejoue aussi les validations du serveur (polices présentes, encre ≤ 300 %, logo dans la zone de sécurité…). Relancer l'import avec le même `--id` remplace le modèle : c'est la façon de le mettre à jour (versionnez par `--id carte-v2` si l'ancien doit rester disponible).

## Mise en ligne

Les dossiers `clients/` sont lus par le serveur au démarrage. Après fusion dans `main` :

```bash
cd UnitsBusinessCards && git pull && docker compose restart cartes   # pas de reconstruction nécessaire
docker compose exec cartes node server/cli.js add-user prenom@acme.fr 'mot-de-passe-long' --client acme
```

(`clients/` est monté en lecture seule dans le conteneur : ajouter un client ou un modèle ne demande qu'un `restart`.)

## Limites connues

- Le fichier maître et le convertisseur ont été validés ensemble (le design du maître redonne le même PDF que le modèle `demo`), mais le convertisseur a tourné sur un export réel de l'API REST du fichier maître : le recto redonne le modèle `demo`. L'API renvoie `fontPostScriptName: null` ; le nom PostScript est alors déduit de la famille et du style (`Inter` + `Semi Bold` → `Inter-SemiBold`), ou imposé par `font=<NomPostScript>` dans le nom du calque pour les polices dont le nom ne suit pas cette règle.
- Le rendu du texte est calculé par l'app (métriques de la police), pas par Figma : de petits écarts verticaux (< 0,5 mm) sont possibles avec un interlignage non automatique. **L'aperçu PNG de `template:check` fait foi**, pas Figma.
- Un seul type d'image dans les modèles : l'emplacement du logo (fourni par le client à chaque envoi). Les illustrations/photos de fond ne sont pas gérées en v1.
- Couleurs écran ≠ papier : validation finale sur BAT.

## Liste de vérification du designer

- [ ] Cadres `page:recto` (et `page:verso`) de taille fini + 2 × 3 mm, mêmes dimensions
- [ ] Cadre `palette` : couleurs en CMJN dans le nom, texte courant en `0/0/0/100`, encre ≤ 300 %
- [ ] Tous les textes à ≥ 3 mm du bord de coupe, corps ≥ 6 pt (≥ 7 pt en réserve sur fond foncé)
- [ ] Tailles de police saisies en mm (voir le tableau) ; champs : nom `champ:…`, largeur fixe, `label`, `max`, `min` renseignés
- [ ] Fonds et aplats jusqu'au bord du cadre (fonds perdus)
- [ ] Aucune opacité, ombre, dégradé, image, vecteur ; calques de notes préfixés par `_`
- [ ] Polices : nom PostScript communiqué + fichiers `.otf` fournis
