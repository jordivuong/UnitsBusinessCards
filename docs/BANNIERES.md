# Modèles de bannières (formats numériques)

Un modèle de bannière est un **package web** : un ZIP de fichiers HTML/CSS, d'images et de polices. L'app l'affiche dans un navigateur (Chromium), pose les textes du client et produit une **image** (PNG, JPG ou WebP, en 1× ou 2×) par format.

Un package d'exemple est téléchargeable depuis l'Admin (« Télécharger un package d'exemple ») et se trouve dans `examples/banniere-demo/`.

## Contenu du ZIP

```
mon-modele.zip
  1200x628.html        un fichier .html par FORMAT (mise en page) — à la racine
  728x90.html
  style.css            feuilles de style, partagées ou non
  assets/logo.svg      images (png, jpg, gif, webp, svg)
  fonts/Inter.woff2    polices (woff, woff2, ttf, otf), déclarées par @font-face
```

Un dossier unique contenant tout (zip d'un dossier sous macOS) est accepté. Limites : 25 Mo le ZIP, 300 fichiers, 60 Mo décompressé.

## Un format = un fichier HTML

```html
<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="banner:size" content="1200x628">          <!-- OBLIGATOIRE : largeur x hauteur en pixels (16 à 4096) -->
  <meta name="banner:label" content="Réseaux sociaux">  <!-- facultatif : nom affiché -->
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div class="banner">
    <img src="assets/logo.svg" alt="">
    <div class="nom"   data-field="nom"   data-label="Nom"      data-max="40" data-fit data-min-size="32" data-sample="Jeanne Martin">Jeanne Martin</div>
    <div class="titre" data-field="titre" data-label="Fonction" data-max="60" data-optional>Directrice</div>
  </div>
</body>
</html>
```

L'app donne exactement la taille du format à `html` et `body` (sans marge) : le conteneur principal peut utiliser `width:100%; height:100%`. Le contenu qui dépasse est coupé.

## Champs variables (`data-field`)

| Attribut | Effet |
|---|---|
| `data-field="nom"` | **rend l'élément modifiable** ; nom du champ = colonne du CSV (a-z, 0-9, `-`, `_`) |
| `data-label="Nom"` | libellé affiché au client (par défaut le nom du champ) |
| `data-max="40"` | nombre maximal de caractères (80 par défaut, 500 au plus) |
| `data-optional` | champ facultatif ; vide, l'élément est masqué |
| `data-sample="…"` | valeur d'exemple utilisée pour les aperçus et le CSV d'exemple |
| `data-fit` | **réduit le corps du texte** jusqu'à ce qu'il tienne dans la boîte (voir ci-dessous) |
| `data-min-size="18"` | corps minimum en px pour `data-fit` (la moitié du corps de départ par défaut) |

Un même nom de champ peut figurer dans plusieurs formats : le client le saisit une seule fois, toutes les tailles sont générées. Le texte saisi est inséré **comme texte** : aucun HTML ne peut être injecté.

**`data-fit`** : donnez à l'élément une boîte fixe (`width`, `height`, `overflow:hidden`, souvent `white-space:nowrap`). L'app réduit le corps par pas de 0,5 px jusqu'au minimum ; si le texte déborde encore, la génération est refusée avec un message (« Le texte « Nom » est trop long pour le format… »). Sans `data-fit`, le texte n'est pas ajusté.

Seuls les champs **texte** sont gérés pour l'instant. Une image variable (photo ou logo envoyé par le client) n'est pas encore possible : les images du modèle sont fixes.

## Ce qui est interdit (l'import refuse et dit pourquoi)

- JavaScript : balises `<script>`, attributs `onclick`/`onload`…, `javascript:` ;
- ressources externes : toute URL `http(s)://` ou `//` (images, polices, `@import`, Google Fonts…). **Mettez tout dans le ZIP** ;
- `<iframe>`, `<object>`, `<embed>`, `<form>`, champs de saisie ;
- fichiers non listés (exécutables, etc.) et SVG contenant des scripts ou des liens externes ;
- fichiers référencés mais absents du ZIP.

Au rendu, le navigateur n'a **aucun accès réseau** et n'exécute aucun JavaScript du modèle : seuls les fichiers du package sont lus.

## Avec le client

1. Admin → fiche du client → *Ajouter un modèle* → *Bannière — depuis un package web* : choisir le ZIP, un identifiant (`banniere-v1`) et un nom.
2. L'app affiche un **aperçu de chaque format** avec les valeurs d'exemple ; *Publier* le rend disponible. Mêmes actions que pour les cartes : masquer, copier vers un autre client, retirer.
3. Côté client : choisir le modèle, saisir les champs (ou importer un CSV, une ligne par bannière), choisir PNG/JPG/WebP et la résolution, générer. Les bannières sont enregistrées comme les cartes (« Mes cartes enregistrées »), modifiables, et téléchargeables une par une ou en ZIP.

## Conseils de conception

- Concevez en pixels à la taille du format ; pour les écrans denses le client choisit « 2× » (même mise en page, rendue en double résolution).
- Les dégradés, ombres, transparences, `filter`, `backdrop-filter` et les animations CSS **sont acceptés** (c'est du numérique) ; une animation est figée sur sa première image.
- Préférez des polices en **woff2** (léger). Une police absente du ZIP est remplacée par une police du système (peu fiable) : fournissez toujours vos polices.
- Testez le pire cas (nom très long) : un `data-fit` mal dimensionné produit un refus, pas une image coupée.
